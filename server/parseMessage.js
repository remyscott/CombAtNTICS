export default function parseMsg(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch(e) {
    console.warn('⚠️ Bad WS message:', raw);
    return;
  }
  return msg;
}