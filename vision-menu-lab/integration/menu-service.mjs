/**
 * IN-MEMORY STORE FOR NON-PRODUCTION CONTRACT TESTS ONLY.
 * Production persistence must be implemented by reviewed SQL RPCs after staging approval.
 */
import { cleanMenuDraft, assertActor, assertTenantMedia, MenuContractError, MODES } from './menu-contract.mjs';
const fail = code => {throw new MenuContractError(code)};
const clone = x => structuredClone(x);
const idkey = (companyId, id) => `${companyId}/${id}`;
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);

export class IsolatedMenuStore {
  #drafts = new Map();
  #revisions = new Map();
  #requests = new Map();
  #intents = new Map();
  #audit = [];
  saveDraft({ actor, companyId, menuId, expectedRevision, requestId, payload, media = [] }) {
    assertActor(actor,companyId);
    const snapshot=cleanMenuDraft(payload);
    assertTenantMedia({companyId,draft:snapshot,media});
    if (!requestId || typeof requestId !== 'string' || requestId.length > 100) fail('invalid_request_id');
    if (!menuId || typeof menuId !== 'string' || menuId.length > 100) fail('invalid_menu_id');
    const reqKey=idkey(companyId,requestId), storedReq=this.#requests.get(reqKey);
    if(storedReq) {
      if(storedReq.menuId !== menuId || !equal(storedReq.snapshot,snapshot) || storedReq.actorId !== actor.userId) fail('idempotency_conflict');
      return {menuId,revision:storedReq.revision,alreadyCommitted:true};
    }
    const key=idkey(companyId,menuId),previous=this.#drafts.get(key);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || expectedRevision !== (previous?.revision ?? 0)) fail('revision_conflict');
    const revision=expectedRevision+1;
    const frozen=clone(snapshot);
    this.#drafts.set(key,{revision,snapshot:frozen});
    this.#revisions.set(idkey(companyId,`${menuId}/${revision}`),frozen);
    this.#requests.set(reqKey,{actorId:actor.userId,menuId,revision,snapshot:frozen});
    this.#audit.push({companyId,menuId,revision,userId:actor.userId,action:'draft_saved'});
    return {menuId,revision,alreadyCommitted:false};
  }
  readRevision({actor,companyId,menuId,revision}) {
    assertActor(actor,companyId,{write:false});
    const saved=this.#revisions.get(idkey(companyId,`${menuId}/${revision}`));
    if(!saved) fail('menu_revision_not_found');
    return clone(saved);
  }
  stageIntent({actor,companyId,menuId,revision,device,mode}) {
    assertActor(actor,companyId);
    if (!MODES.includes(mode)) fail('invalid_mode');
    if (!device || device.companyId !== companyId || device.retired === true || device.accessStatus !== 'active') fail('device_not_allowed');
    const menu=this.readRevision({actor,companyId,menuId,revision});
    if(mode !== 'normal' && !menu.products.some(p => p.enabled)) fail('empty_menu');
    // No write to an existing playlist, campaign, Player, or device gateway.
    // Both menu_only and interleave are quarantined until policy arbitration is approved.
    const status=mode === 'normal' ? 'normal_untouched' : 'review_required';
    const intent={companyId,menuId,revision,deviceId:device.id,mode,status,active:false};
    this.#intents.set(idkey(companyId,device.id),clone(intent));
    this.#audit.push({companyId,menuId,revision,userId:actor.userId,deviceId:device.id,action:'intent_staged'});
    return clone(intent);
  }
  readIntent({actor,companyId,deviceId}) {
    assertActor(actor,companyId,{write:false});
    const value=this.#intents.get(idkey(companyId,deviceId));
    return value?clone(value):null;
  }
  audit({actor,companyId}) {
    assertActor(actor,companyId,{write:false});
    return clone(this.#audit.filter(row=>row.companyId===companyId));
  }
}
