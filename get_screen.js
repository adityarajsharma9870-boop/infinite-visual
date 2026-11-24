const { execSync } = require('child_process');
const fs = require('fs');
const adb = '"C:\\Program Files\\BlueStacks_nxt\\HD-Adb.exe"';
try {
  console.log(execSync(`${adb} connect 127.0.0.1:5555`).toString());
  console.log(execSync(`${adb} connect 127.0.0.1:5565`).toString());
  console.log(execSync(`${adb} devices`).toString());
  const b = execSync(`${adb} exec-out screencap -p`);
  fs.writeFileSync('C:/Users/Aditya Raj/.gemini/antigravity/brain/d32c8e39-c43c-4221-b82d-ef072241e59e/clean_screen.png', b);
  console.log('Captured cleanly, bytes:', b.length);
} catch (e) {
  console.error('Error:', e.message);
}
