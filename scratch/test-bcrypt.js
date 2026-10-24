const bcrypt = require('bcryptjs');

async function test() {
  const otp = '123456';
  const hash = await bcrypt.hash(otp, 12);
  console.log('Hash:', hash);
  const match = await bcrypt.compare(otp, hash);
  console.log('Match:', match);
  const fail = await bcrypt.compare('654321', hash);
  console.log('Fail:', fail);
}

test();
