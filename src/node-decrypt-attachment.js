/****
  ADAPTED FROM https://github.com/matrix-org/browser-encrypt-attachment
  
  The "browser-encrypt-attachment" requires the WebCrypto API, which is not available on node.
  This file recreates the decryptAttachment function using the node crypto library.
****/


// Crypto from Node
var crypto = require('crypto');


// Fill-in for atob
// From: https://github.com/node-browser-compat/atob

function atob(str) {
  return new Buffer(str, 'base64').toString('binary');
}


/**
 * Decrypt an attachment.
 * @param {ArrayBuffer} ciphertextBuffer The encrypted attachment data buffer.
 * @param {Object} info The information needed to decrypt the attachment.
 * @param {Object} info.key AES-CTR JWK key object.
 * @param {string} info.iv Base64 encoded 16 byte AES-CTR IV.
 * @param {string} info.hashes.sha256 Base64 encoded SHA-256 hash of the ciphertext.
 * @return {Promise} A promise that resolves with an ArrayBuffer when the attachment is decrypted.
 */
function decryptAttachment(ciphertextBuffer, info) {

    if (info === undefined || info.key === undefined || info.iv === undefined
        || info.hashes === undefined || info.hashes.sha256 === undefined) {
       throw new Error("Invalid info. Missing info.key, info.iv or info.hashes.sha256 key");
    }

    var ivBuffer = new Buffer(decodeBase64(info.iv));
    var keyBuffer = new Buffer(decodeBase64(info.key.k));
    var expectedSha256base64 = info.hashes.sha256;

    // Is the SHA256 correct?
    var hash = crypto.createHash('sha256');
    hash.update(ciphertextBuffer);

    var resultingHash = hash.digest('base64');
    if(!expectedSha256base64 || resultingHash.substr(0, expectedSha256base64.length) != expectedSha256base64) {
        // We substr the resultingHash, as it is given in base64 with padding while the expected one is
        // without padding.
        throw new Error("Mismatched SHA-256 digest");
    }

    /* TODO - This is from matrix-org/browser-encrypt-attachment, but I really do not know what to do with it
    var counterLength;
    if (info.v == "v1" || info.v == "v2") {
      // Version 1 and 2 use a 64 bit counter.
      counterLength = 64;
    } else {
      // Version 0 uses a 128 bit counter.
      counterLength = 128;
    }
    */

    // Use node crypto library - Decipher object
    var decipher = crypto.createDecipheriv('aes-256-ctr', keyBuffer, ivBuffer);

    return Promise.resolve(Buffer.concat([decipher.update(ciphertextBuffer) , decipher.final()]));
}


/**
 * Decode a base64 string to a typed array of uint8.
 * This will decode unpadded base64, but will also accept base64 with padding.
 * @param {string} base64 The unpadded base64 to decode.
 * @return {Uint8Array} The decoded data.
 */
function decodeBase64(base64) {
    // Pad the base64 up to the next multiple of 4.
    var paddedBase64 = base64 + "===".slice(0, (4 - base64.length % 4) % 4);
    // Decode the base64 as a misinterpreted Latin-1 string.
    // atob returns a unicode string with codepoints in the range 0-255.
    var latin1String = atob(paddedBase64);
    // Encode the string as a Uint8Array as Latin-1.
    var uint8Array = new Uint8Array(latin1String.length);
    for (var i = 0; i < latin1String.length; i++) {
        uint8Array[i] = latin1String.charCodeAt(i);
    }
    return uint8Array;
}

try {
    exports.decryptAttachment = decryptAttachment;
}
catch (e) {
    // Ignore unknown variable "exports" errors when this is loaded directly into a browser
    // This means that we can test it without having to use browserify.
    // The intention is that the library is used using browserify.
}

