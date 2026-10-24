// Preloaded into the server under test: swaps the real SMTP transport for an
// in-memory one so tests never touch the network or send email.
const nodemailer = require('nodemailer');
const original = nodemailer.createTransport.bind(nodemailer);
nodemailer.createTransport = () => original({ jsonTransport: true });

// TEST_NO_NATIVE_BCRYPT=1 simulates a host where the optional native `bcrypt`
// module can't load, so the whole suite can be run against the bcryptjs fallback.
if (process.env.TEST_NO_NATIVE_BCRYPT) {
  const Module = require('node:module');
  const load = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'bcrypt') throw new Error('simulated: native bcrypt unavailable');
    return load.call(this, request, ...rest);
  };
}
