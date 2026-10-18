// Fail-closed, explicit opt-in for real commercial display on an individual TV.
// No customer IDs or production environment secrets are baked into source control.
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function commercialPilotDeviceAllowed(deviceId, globalFlag, allowedDeviceIds) {
  if(globalFlag!=='true'||typeof deviceId!=='string'||!UUID.test(deviceId))return false;
  if(typeof allowedDeviceIds!=='string'||allowedDeviceIds.length>512)return false;
  const entries=allowedDeviceIds.split(',').map(item=>item.trim());
  if(entries.length<1||entries.length>5||entries.some(item=>!UUID.test(item)))return false;
  return entries.some(item=>item.toLowerCase()===deviceId.toLowerCase());
}
