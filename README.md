# My Port

Personal portfolio tracker (static web app).

- ข้อมูลถูกเข้ารหัส AES-256-GCM (PBKDF2 600k iterations) — ปลดล็อคด้วย PIN ในเบราว์เซอร์เท่านั้น
- ซิงก์ข้ามเครื่องผ่าน GitHub Contents API (ไฟล์ `data2.enc.json` บน branch `data` (เวอร์ชันก่อนใช้ `data.enc.json`) — เข้ารหัสก่อนอัพโหลดเสมอ)
- ไม่มีข้อมูลการเงินแบบอ่านออกอยู่ใน repo นี้
- `core.js` สูตรที่ใช้ร่วมกันระหว่างหน้าเว็บกับ `tools/port-cli.js` (สคริปต์บันทึกข้อมูลที่ถอดจากรูป)
