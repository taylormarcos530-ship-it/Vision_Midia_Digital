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
features={n.get(a+'name'):n.get(a+'required') for n in r.findall('uses-feature')}
assert features.get('android.software.leanback')=='false','Declare optional Android TV support'
assert app.get(a+'banner')=='@drawable/tv_banner','Provide TV launcher banner'
assert (p.parent/'res/drawable/tv_banner.xml').exists(),'Banner resource missing'
print('Android TV launcher declaration and banner PASS')
assert app.get(a+'icon')=='@drawable/probe_icon','Self-contained launcher icon required'
