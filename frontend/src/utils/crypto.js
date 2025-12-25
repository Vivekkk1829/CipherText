import { ec as EC } from "elliptic";
import CryptoJS from "crypto-js";

// Initialize Elliptic Curve (Curve25519 is the industry standard for chat)
const ec = new EC("curve25519");

/* 1. KEY GENERATION (Run this once on Signup/Login)
   Returns: { publicKey (Hex), privateKey (Hex) }
*/
export const generateKeyPair = () => {
  const key = ec.genKeyPair();
  return {
    publicKey: key.getPublic("hex"),
    privateKey: key.getPrivate("hex"),
  };
};

/* 2. DERIVE SHARED SECRET (The "Magic" Step)
   Input: My Private Key + Their Public Key
   Output: A Secret Key only you two know
*/
const deriveSecret = (myPrivateKeyHex, otherPublicKeyHex) => {
  try {
    const myKey = ec.keyFromPrivate(myPrivateKeyHex);
    const otherKey = ec.keyFromPublic(otherPublicKeyHex, "hex");
    // Deriving the shared secret
    return myKey.derive(otherKey.getPublic()).toString(16);
  } catch (error) {
    console.error("Key derivation failed", error);
    return null;
  }
};

/* 3. ENCRYPT MESSAGE (AES + IV)
   Input: Message text, keys
   Output: { content: "encrypted_string", iv: "random_hex_string" }
*/
export const encryptMessage = (message, myPrivateKey, otherPublicKey) => {
  const secret = deriveSecret(myPrivateKey, otherPublicKey);
  if (!secret) return null;

  // 1. Generate a random IV (16 bytes)
  // This ensures "Hello" looks different every time it is sent.
  const iv = CryptoJS.lib.WordArray.random(16);

  // 2. Encrypt using the Secret + IV
  const encrypted = CryptoJS.AES.encrypt(message, secret, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  // 3. Return BOTH the Ciphertext and the IV (as Hex strings)
  return {
    content: encrypted.toString(),
    iv: iv.toString(CryptoJS.enc.Hex),
  };
};

/* 4. DECRYPT MESSAGE (AES + IV)
   Input: Ciphertext, IV (Hex), keys
   Output: Original Text
*/
export const decryptMessage = (ciphertext, ivHex, myPrivateKey, otherPublicKey) => {
  const secret = deriveSecret(myPrivateKey, otherPublicKey);
  if (!secret) return "Error: Key Missing";

  try {
    // 1. Convert the Hex string IV back to WordArray
    const iv = CryptoJS.enc.Hex.parse(ivHex);

    // 2. Decrypt using the same IV
    const bytes = CryptoJS.AES.decrypt(ciphertext, secret, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });

    const originalText = bytes.toString(CryptoJS.enc.Utf8);
    return originalText || "Decryption Error";
  } catch (error) {
    console.error("Decryption crashed:", error);
    return "Malformed Data";
  }
};

/* -------------------------------------------------------------------------- */
/* SECURE BACKUP: WRAPPING KEYS WITH PASSWORD                                */
/* -------------------------------------------------------------------------- */

// 1. BACKUP: Encrypt the Private Key using the User's Password
export const encryptPrivateKey = (privateKey, password) => {
  // Ideally, we would use an IV here too, but to keep your User Schema simple
  // we will stick to standard AES encryption for the vault.
  return CryptoJS.AES.encrypt(privateKey, password).toString();
};

// 2. RESTORE: Decrypt the Private Key using the User's Password
export const decryptPrivateKey = (encryptedPrivateKey, password) => {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedPrivateKey, password);
    const originalKey = bytes.toString(CryptoJS.enc.Utf8);

    if (!originalKey) throw new Error("Wrong password or corrupted key");
    return originalKey;
  } catch (error) {
    console.error("Failed to restore private key", error);
    return null;
  }
};