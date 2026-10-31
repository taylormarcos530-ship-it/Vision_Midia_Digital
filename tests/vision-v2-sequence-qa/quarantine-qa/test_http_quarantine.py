"""Real PostgreSQL 17 + loopback HTTP protocol tests; all identities synthetic."""
import concurrent.futures
import json
import os
import unittest
import urllib.error
import urllib.request

import psycopg
from server import DSN, hash_token, start_test_server

TOK_A="qa-device-token-A-0123456789"
TOK_B="qa-device-token-B-0123456789"

def event(seq,media="ad-A",boot="boot-qa-0001"):
    return {"sequence":seq,"event_id":f"proof-{seq:08d}",
        "media_id":media,"boot_id":boot,"mono_ms":seq*15000,
        "seconds":15,"completed":True}

class QuarantineHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with psycopg.connect(DSN) as conn:
            name=conn.execute("SELECT current_database()").fetchone()[0]
            if name!="vision_v2_quarantine_disposable":
                raise RuntimeError("NO-GO: not disposable")
        cls.server,cls.thread=start_test_server()
        cls.url=f"http://127.0.0.1:{cls.server.server_address[1]}/qa/quarantine"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close();cls.thread.join(3)

    def setUp(self):
        with psycopg.connect(DSN) as conn:
            conn.execute("DELETE FROM v2_quarantine_qa.receipts")
            conn.execute("DELETE FROM v2_quarantine_qa.devices")
            conn.execute("INSERT INTO v2_quarantine_qa.devices(company_id,device_id,stream_id,token_sha256) VALUES(%s,%s,%s,%s)",
                         ("company-A","device-A","stream-A",hash_token(TOK_A)))
            conn.execute("INSERT INTO v2_quarantine_qa.devices(company_id,device_id,stream_id,token_sha256) VALUES(%s,%s,%s,%s)",
                         ("company-B","device-B","stream-B",hash_token(TOK_B)))
    def post(self,events,device="device-A",stream="stream-A",token=TOK_A,raw=None):
        payload=json.dumps({"device_id":device,"stream_id":stream,"events":events}).encode() if raw is None else raw
        request=urllib.request.Request(self.url, data=payload,method="POST",
            headers={"Content-Type":"application/json","x-device-token":token})
        try:
            with urllib.request.urlopen(request,timeout=8) as r:
                return r.status,json.load(r)
        except urllib.error.HTTPError as r:
            return r.code,json.loads(r.read())
    def select(self,sql,params=()):
        with psycopg.connect(DSN) as conn:
            return conn.execute(sql,params).fetchall()

    def test_first_batch_ack_only_after_commit_and_non_billable(self):
        status,result=self.post([event(1),event(2)])
        self.assertEqual(status,200)
        self.assertEqual(result,{"ack":2,"accepted":2,"duplicates":0,"quarantined":2,"billable":0})
        rows=self.select("SELECT sequence,company_id,status,billable,event_played_at,received_at IS NOT NULL FROM v2_quarantine_qa.receipts ORDER BY sequence")
        self.assertEqual(rows,[(1,"company-A","PENDING_TIME",False,None,True),(2,"company-A","PENDING_TIME",False,None,True)])
        self.assertEqual(self.select("SELECT watermark FROM v2_quarantine_qa.devices WHERE device_id='device-A'"),[(2,)])
        print("HTTP_QUARANTINE_ACK_PASS ack=2 nonbillable=2")

    def test_replay_has_no_new_receipt(self):
        self.post([event(1),event(2)])
        status,result=self.post([event(1),event(2)])
        self.assertEqual(status,200)
        self.assertEqual((result["ack"],result["accepted"],result["duplicates"]),(2,0,2))
        self.assertEqual(self.select("SELECT count(*) FROM v2_quarantine_qa.receipts"),[(2,)])

    def test_gap_rolls_back_entire_batch(self):
        s,x=self.post([event(1),event(3)])
        self.assertEqual((s,x["error"]),(409,"sequence_gap"))
        self.assertEqual(self.select("SELECT count(*) FROM v2_quarantine_qa.receipts"),[(0,)])
        self.assertEqual(self.select("SELECT watermark FROM v2_quarantine_qa.devices WHERE device_id='device-A'"),[(0,)])

    def test_wrong_token_cannot_read_or_post_other_company(self):
        status,_=self.post([event(1)],device="device-B",stream="stream-B",token=TOK_A)
        self.assertEqual(status,401)
        status,_=self.post([event(1)],device="device-B",stream="stream-A",token=TOK_B)
        self.assertEqual(status,401)
        status,result=self.post([event(1)],device="device-B",stream="stream-B",token=TOK_B)
        self.assertEqual(status,200)
        self.assertEqual(result["ack"],1)
        self.assertEqual(self.select("SELECT company_id FROM v2_quarantine_qa.receipts"),[("company-B",)])

    def test_replayed_sequence_with_changed_content_is_rejected(self):
        self.post([event(1)])
        tampered=event(1);tampered["seconds"]=66
        status,result=self.post([tampered])
        self.assertEqual((status,result["error"]),(409,"conflicting_replay"))
        self.assertEqual(self.select("SELECT count(*) FROM v2_quarantine_qa.receipts"),[(1,)])

    def test_timestamp_never_accepted_from_client(self):
        fake=event(1);fake["played_at"]="1970-01-01T00:00:00Z"
        status,result=self.post([fake])
        self.assertEqual(status,400)
        self.assertEqual(result["error"],"invalid_event_fields_or_timestamp")
        self.assertEqual(self.select("SELECT count(*) FROM v2_quarantine_qa.receipts"),[(0,)])

    def test_50_event_limit_and_51_rejected(self):
        s,r=self.post([event(i) for i in range(1,51)])
        self.assertEqual(s,200);self.assertEqual(r["ack"],50)
        s,r=self.post([event(i) for i in range(51,102)])
        self.assertEqual(s,400);self.assertEqual(r["error"],"invalid_batch")
        self.assertEqual(self.select("SELECT count(*) FROM v2_quarantine_qa.receipts"),[(50,)])

    def test_all_six_concurrent_retries_count_two_only(self):
        batch=[event(1),event(2)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
            results=list(ex.map(lambda _:self.post(batch),range(6)))
        self.assertTrue(all(status==200 for status,_ in results),results)
        self.assertEqual(sum(d["accepted"] for _,d in results),2)
        self.assertEqual(sum(d["duplicates"] for _,d in results),10)
        self.assertEqual(self.select("SELECT count(*) FROM v2_quarantine_qa.receipts"),[(2,)])
        self.assertEqual(self.select("SELECT watermark FROM v2_quarantine_qa.devices WHERE device_id='device-A'"),[(2,)])
        print("HTTP_QUARANTINE_CONCURRENCY_PASS six_writers=2_unique")

    def test_injected_database_failure_causes_503_without_ack(self):
        with psycopg.connect(DSN) as conn:
            conn.execute("""CREATE OR REPLACE FUNCTION v2_quarantine_qa.fail_qa() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.media_id='qa_fault' THEN
                RAISE EXCEPTION 'qa-injected-disk-failure'; END IF; RETURN NEW; END $$""")
            conn.execute("""CREATE TRIGGER qa_force_failure BEFORE INSERT ON v2_quarantine_qa.receipts
                FOR EACH ROW EXECUTE FUNCTION v2_quarantine_qa.fail_qa()""")
        try:
            status,result=self.post([event(1),event(2,media="qa_fault")])
            self.assertEqual((status,result["error"]),(503,"gateway_unavailable"))
            self.assertEqual(self.select("SELECT count(*) FROM v2_quarantine_qa.receipts"),[(0,)])
            self.assertEqual(self.select("SELECT watermark FROM v2_quarantine_qa.devices WHERE device_id='device-A'"),[(0,)])
            print("HTTP_QUARANTINE_ROLLBACK_PASS ack_unchanged=0")
        finally:
            with psycopg.connect(DSN) as conn:
                conn.execute("DROP TRIGGER IF EXISTS qa_force_failure ON v2_quarantine_qa.receipts")

    def test_new_stream_rejects_old_id_without_reset(self):
        self.post([event(1)])
        with psycopg.connect(DSN) as conn:
            conn.execute("UPDATE v2_quarantine_qa.devices SET stream_id='stream-new' WHERE device_id='device-A'")
        status,_=self.post([event(1)])
        self.assertEqual(status,401)
        self.assertEqual(self.select("SELECT watermark FROM v2_quarantine_qa.devices WHERE device_id='device-A'"),[(1,)])

    def test_bad_json_and_missing_token(self):
        s,_=self.post([],raw=b"{truncated")
        self.assertEqual(s,400)
        s,_=self.post([event(1)],token="bad")
        self.assertEqual(s,401)

if __name__=="__main__":unittest.main(verbosity=2)
