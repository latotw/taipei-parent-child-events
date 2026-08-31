/**
 * 前端加密模組：用瀏覽器標準的 Web Crypto API（AES-256-GCM）把日記內容
 * 在「離開這台裝置之前」就加密完成。
 *
 * 金鑰不是直接用密碼，而是用 PBKDF2-SHA256 從密碼推導出來的，
 * 每次加密都會產生新的 salt 與 IV（AES-GCM 絕對不能重複使用同一組 key + IV）。
 *
 * 加密字串（envelope）格式，以 "." 分隔，各段皆為 base64：
 *
 *   GJ1.<iterations>.<salt>.<iv>.<ciphertext+tag>
 *
 * 前面兩段（版本 + 迭代次數）同時作為 AES-GCM 的 additionalData，
 * 所以有人偷改迭代次數的話，解密會直接驗證失敗而不是安靜地算出別的金鑰。
 */

import type { JournalPayload } from "@/lib/types";

const ENVELOPE_PREFIX = "GJ1";
const ENVELOPE_PARTS = 5;
/**
 * OWASP（2023）對 PBKDF2-HMAC-SHA256 的建議值。手機上大約要 0.5～1 秒，
 * 所以 UI 在加解密期間會顯示「加密中…」。迭代次數寫在加密字串裡，
 * 日後要調整也不會讓舊的加密字串解不開。
 */
const KDF_ITERATIONS = 600_000;
const MAX_KDF_ITERATIONS = 5_000_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/**
 * TypeScript 5.7 之後 Uint8Array 帶有 buffer 的型別參數，而 Web Crypto 的
 * BufferSource 只接受 ArrayBuffer（不含 SharedArrayBuffer），所以固定寫死。
 */
type Bytes = Uint8Array<ArrayBuffer>;

export type CryptoErrorCode =
  /** 沒有可用的 Web Crypto（非 HTTPS / localhost，或太舊的瀏覽器） */
  | "UNSUPPORTED"
  /** 密碼欄位是空的 */
  | "EMPTY_PASSPHRASE"
  /** 沒有任何內容可以加密 */
  | "EMPTY_CONTENT"
  /** 沒有給加密字串 */
  | "EMPTY_CIPHERTEXT"
  /** 加密字串格式不對，根本不是本模組產生的 */
  | "BAD_ENVELOPE"
  /** 通過格式檢查但驗證失敗：密碼錯誤或內容被改過 */
  | "WRONG_PASSPHRASE"
  /** 解得開，但裡面不是預期的日記結構 */
  | "CORRUPT_PAYLOAD";

/** 帶錯誤代碼的例外，message 直接是可以顯示給使用者的中文提示。 */
export class CryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, message: string) {
    super(message);
    this.name = "CryptoError";
    this.code = code;
  }
}

/** 把任何例外轉成可以顯示的中文訊息。 */
export function describeCryptoError(error: unknown): string {
  if (error instanceof CryptoError) return error.message;
  return "加解密時發生未預期的錯誤，請再試一次。";
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new CryptoError(
      "UNSUPPORTED",
      "這個環境無法使用 Web Crypto，請改用 HTTPS 或 localhost 開啟。",
    );
  }
  return subtle;
}

function randomBytes(length: number): Bytes {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Bytes {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new CryptoError("BAD_ENVELOPE", "加密字串的格式不正確，無法解讀。");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 空白（或只有空白字元）的密碼一律拒絕。密碼本身不做 trim，空格也算內容。 */
function assertPassphrase(passphrase: string): void {
  if (passphrase.trim() === "") {
    throw new CryptoError("EMPTY_PASSPHRASE", "請先輸入共用解密密碼。");
  }
}

function assertHasContent(payload: JournalPayload): void {
  const hasItem = payload.items.some((item) => item.trim() !== "");
  if (!hasItem && payload.notes.trim() === "") {
    throw new CryptoError("EMPTY_CONTENT", "還沒有任何內容可以加密。");
  }
}

async function deriveKey(
  subtle: SubtleCrypto,
  passphrase: string,
  salt: Bytes,
  iterations: number,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const baseKey = await subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

/** 版本與迭代次數一起送進 GCM 驗證，避免被人偷改。 */
function additionalData(iterations: number): Bytes {
  return new TextEncoder().encode(`${ENVELOPE_PREFIX}.${iterations}`);
}

/**
 * 把任意字串加密成 envelope。日記與密碼驗證字串都走這裡。
 *
 * @throws {CryptoError} 密碼為空（EMPTY_PASSPHRASE）
 */
export async function encryptText(
  plaintext: string,
  passphrase: string,
): Promise<string> {
  assertPassphrase(passphrase);

  const subtle = getSubtle();
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(subtle, passphrase, salt, KDF_ITERATIONS, [
    "encrypt",
  ]);

  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(KDF_ITERATIONS) },
    key,
    new TextEncoder().encode(plaintext),
  );

  return [
    ENVELOPE_PREFIX,
    String(KDF_ITERATIONS),
    toBase64(salt),
    toBase64(iv),
    toBase64(new Uint8Array(ciphertext)),
  ].join(".");
}

function parseEnvelope(envelope: string): {
  iterations: number;
  salt: Bytes;
  iv: Bytes;
  ciphertext: Bytes;
} {
  const badEnvelope = new CryptoError(
    "BAD_ENVELOPE",
    "加密字串的格式不正確，無法解讀。",
  );

  const parts = envelope.trim().split(".");
  if (parts.length !== ENVELOPE_PARTS || parts[0] !== ENVELOPE_PREFIX) {
    throw badEnvelope;
  }

  const iterations = Number(parts[1]);
  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > MAX_KDF_ITERATIONS
  ) {
    throw badEnvelope;
  }

  const salt = fromBase64(parts[2]);
  const iv = fromBase64(parts[3]);
  const ciphertext = fromBase64(parts[4]);
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) throw badEnvelope;
  // AES-GCM 至少要有 16 bytes 的驗證標籤。
  if (ciphertext.length < 16) throw badEnvelope;

  return { iterations, salt, iv, ciphertext };
}

function asJournalPayload(value: unknown): JournalPayload {
  const corrupt = new CryptoError(
    "CORRUPT_PAYLOAD",
    "解密成功，但內容不是預期的日記格式。",
  );

  if (typeof value !== "object" || value === null) throw corrupt;
  const candidate = value as Partial<JournalPayload>;
  if (
    typeof candidate.date !== "string" ||
    typeof candidate.notes !== "string" ||
    typeof candidate.savedAt !== "string" ||
    !Array.isArray(candidate.items) ||
    !candidate.items.every((item) => typeof item === "string")
  ) {
    throw corrupt;
  }

  return {
    date: candidate.date,
    items: candidate.items,
    notes: candidate.notes,
    savedAt: candidate.savedAt,
  };
}

/**
 * 用密碼把 envelope 還原成原本的字串。
 *
 * @throws {CryptoError} 密碼為空（EMPTY_PASSPHRASE）、沒給字串（EMPTY_CIPHERTEXT）、
 * 格式不對（BAD_ENVELOPE）、密碼錯誤或內容被改過（WRONG_PASSPHRASE）
 */
export async function decryptText(
  envelope: string,
  passphrase: string,
): Promise<string> {
  assertPassphrase(passphrase);
  if (envelope.trim() === "") {
    throw new CryptoError("EMPTY_CIPHERTEXT", "請先貼上要解密的加密字串。");
  }

  const subtle = getSubtle();
  const { iterations, salt, iv, ciphertext } = parseEnvelope(envelope);
  const key = await deriveKey(subtle, passphrase, salt, iterations, ["decrypt"]);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(iterations) },
      key,
      ciphertext,
    );
  } catch {
    // AES-GCM 驗證失敗時瀏覽器只會丟一個不帶細節的 OperationError，
    // 密碼錯誤與內容被竄改在這裡是分不出來的。
    throw new CryptoError(
      "WRONG_PASSPHRASE",
      "密碼錯誤，或加密內容已被更動，無法解密。",
    );
  }

  return new TextDecoder().decode(plaintext);
}

/**
 * 把日記物件加密成單一字串。
 *
 * @throws {CryptoError} 密碼為空（EMPTY_PASSPHRASE）或沒有內容（EMPTY_CONTENT）
 */
export async function encryptJournal(
  payload: JournalPayload,
  passphrase: string,
): Promise<string> {
  assertPassphrase(passphrase);
  assertHasContent(payload);
  return encryptText(JSON.stringify(payload), passphrase);
}

/**
 * 用密碼把加密字串還原成原本的日記物件。
 *
 * @throws {CryptoError} 同 decryptText，另加內容結構不符（CORRUPT_PAYLOAD）
 */
export async function decryptJournal(
  envelope: string,
  passphrase: string,
): Promise<JournalPayload> {
  const plaintext = await decryptText(envelope, passphrase);

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new CryptoError(
      "CORRUPT_PAYLOAD",
      "解密成功，但內容不是預期的日記格式。",
    );
  }

  return asJournalPayload(parsed);
}

/**
 * 共用密碼的驗證字串（probe）：把一段固定文字加密後放到 workspace 上，
 * 另一台裝置就能判斷「自己輸入的密碼跟對方是不是同一組」，
 * 而伺服器看到的仍然只是一段 envelope。
 *
 * 這不會多洩漏什麼：日記本身的 envelope 一樣可以拿來離線試密碼，
 * 真正的防線是 PBKDF2 的成本與密碼強度。
 */
const PASSPHRASE_PROBE_TEXT = "gratitude-journal/passphrase-probe/v1";

export function createPassphraseProbe(passphrase: string): Promise<string> {
  return encryptText(PASSPHRASE_PROBE_TEXT, passphrase);
}

/** 密碼是否與 probe 相符。任何錯誤（含格式錯誤）都當成不相符。 */
export async function passphraseMatchesProbe(
  probe: string,
  passphrase: string,
): Promise<boolean> {
  try {
    return (await decryptText(probe, passphrase)) === PASSPHRASE_PROBE_TEXT;
  } catch {
    return false;
  }
}

/** 給 UI 顯示用的說明文字。 */
export const CRYPTO_INFO = {
  algorithm: "AES-256-GCM",
  kdf: `PBKDF2-SHA256 · ${KDF_ITERATIONS.toLocaleString("en-US")} 次`,
} as const;
