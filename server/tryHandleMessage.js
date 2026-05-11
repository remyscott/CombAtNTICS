export default function tryHandleMessage(raw, onMessage) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch(e) {
    console.warn('⚠️ Bad WS message:', raw);
    return;
  }
  if (msg.type) onMessage(msg);
  
}