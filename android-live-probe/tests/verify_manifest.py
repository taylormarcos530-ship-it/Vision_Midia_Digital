import pathlib,xml.etree.ElementTree as E
p=pathlib.Path(__file__).resolve().parents[1]/'app/src/main/AndroidManifest.xml'
assert p.exists(),'Manifest missing'
r=E.parse(p).getroot();a='{http://schemas.android.com/apk/res/android}'
permissions={n.get(a+'name') for n in r.findall('uses-permission')}
assert permissions=={'android.permission.FOREGROUND_SERVICE','android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION','android.permission.POST_NOTIFICATIONS'},permissions
app=r.find('application');assert app.get(a+'allowBackup')=='false'
s=app.find('service');assert s.get(a+'exported')=='false';assert s.get(a+'foregroundServiceType')=='mediaProjection'
assert not app.findall('receiver'),'No autostart receivers'
print('Manifest: isolated capture permissions, private service, no autostart PASS')
