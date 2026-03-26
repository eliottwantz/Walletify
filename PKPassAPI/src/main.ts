import { toBuffer } from "@bwip-js/node";
import { Elysia } from "elysia";
import { PKPass } from "passkit-generator";
import { z } from "zod";

console.log(`Using APP_ENV=${Bun.env.APP_ENV}`);

const APPLE_PKPASS_MIME = "application/vnd.apple.pkpass";
const FAVICON_FETCH_TIMEOUT_MS = 5_000;
const FAVICON_SIZE = 256;
const FAVICON_SERVICE_URL = "https://www.google.com/s2/favicons";
const RUNTIME_ROOT = process.cwd();
const PASS_ASSET_CANDIDATES = [
  `${RUNTIME_ROOT}/src/assets/pass`,
  `${import.meta.dir}/assets/pass`,
  `${import.meta.dir}/../src/assets/pass`,
];

type RuntimeConfig = {
  assets: Record<string, Buffer>;
  certificates: {
    signerCert: Buffer;
    signerKey: Buffer;
    signerKeyPassphrase?: string;
    wwdr: Buffer;
  };
  organizationName: string;
  passTypeIdentifier: string;
  teamIdentifier: string;
  colors: {
    background: string;
    foreground: string;
    label: string;
  };
};

type WalletBarcodeFormat =
  | "PKBarcodeFormatAztec"
  | "PKBarcodeFormatCode128"
  | "PKBarcodeFormatPDF417"
  | "PKBarcodeFormatQR";

type RenderedStripDefinition = {
  bcid: string;
  encoderOptions?: Record<string, boolean | number | string>;
};

type BarcodeStrategy =
  | { format: WalletBarcodeFormat; kind: "native" }
  | ({ kind: "renderedStrip" } & RenderedStripDefinition)
  | { detectedType: string; kind: "unsupported" };

const PASS_MESSAGE_ENCODING = "iso-8859-1";
const STRIP_RENDER_CONFIG = {
  backgroundcolor: "FFFFFF",
  barcolor: "000000",
  paddingwidth: 10,
} as const;
const STRIP_RENDER_VARIANTS = [
  { filename: "strip.png", scale: 1 },
  { filename: "strip@2x.png", scale: 2 },
  { filename: "strip@3x.png", scale: 3 },
] as const;
const NATIVE_WALLET_TYPES = new Map<string, WalletBarcodeFormat>([
  ["VNBarcodeSymbologyAztec", "PKBarcodeFormatAztec"],
  ["VNBarcodeSymbologyCode128", "PKBarcodeFormatCode128"],
  ["VNBarcodeSymbologyPDF417", "PKBarcodeFormatPDF417"],
  ["VNBarcodeSymbologyQR", "PKBarcodeFormatQR"],
  ["org.iso.Aztec", "PKBarcodeFormatAztec"],
  ["org.iso.Code128", "PKBarcodeFormatCode128"],
  ["org.iso.PDF417", "PKBarcodeFormatPDF417"],
  ["org.iso.QRCode", "PKBarcodeFormatQR"],
]);
const RENDERED_STRIP_TYPES = new Map<string, RenderedStripDefinition>([
  ["Codabar", { bcid: "rationalizedCodabar" }],
  ["VNBarcodeSymbologyCode39", { bcid: "code39" }],
  ["VNBarcodeSymbologyCode39Checksum", { bcid: "code39", encoderOptions: { includecheck: true } }],
  ["VNBarcodeSymbologyCode39FullASCII", { bcid: "code39ext" }],
  [
    "VNBarcodeSymbologyCode39FullASCIIChecksum",
    { bcid: "code39ext", encoderOptions: { includecheck: true } },
  ],
  ["VNBarcodeSymbologyCode93", { bcid: "code93" }],
  ["VNBarcodeSymbologyCode93i", { bcid: "code93ext" }],
  ["VNBarcodeSymbologyCodabar", { bcid: "rationalizedCodabar" }],
  ["VNBarcodeSymbologyEAN13", { bcid: "ean13" }],
  ["VNBarcodeSymbologyEAN8", { bcid: "ean8" }],
  ["VNBarcodeSymbologyGS1DataBar", { bcid: "databaromni" }],
  ["VNBarcodeSymbologyGS1DataBarExpanded", { bcid: "databarexpanded" }],
  ["VNBarcodeSymbologyGS1DataBarLimited", { bcid: "databarlimited" }],
  ["VNBarcodeSymbologyI2of5", { bcid: "interleaved2of5" }],
  ["VNBarcodeSymbologyI2of5Checksum", { bcid: "interleaved2of5" }],
  ["VNBarcodeSymbologyITF14", { bcid: "itf14" }],
  ["VNBarcodeSymbologyMSIPlessey", { bcid: "msi" }],
  ["VNBarcodeSymbologyUPCE", { bcid: "upce" }],
  ["com.intermec.Code93", { bcid: "code93" }],
  ["org.ansi.Interleaved2of5", { bcid: "interleaved2of5" }],
  ["org.gs1.EAN-13", { bcid: "ean13" }],
  ["org.gs1.EAN-8", { bcid: "ean8" }],
  ["org.gs1.GS1DataBar", { bcid: "databaromni" }],
  ["org.gs1.GS1DataBarExpanded", { bcid: "databarexpanded" }],
  ["org.gs1.GS1DataBarLimited", { bcid: "databarlimited" }],
  ["org.gs1.ITF14", { bcid: "itf14" }],
  ["org.gs1.UPC-E", { bcid: "upce" }],
  ["org.iso.Code39", { bcid: "code39" }],
  ["org.iso.Code39Mod43", { bcid: "code39", encoderOptions: { includecheck: true } }],
  // ["org.iso.MicroPDF417", { bcid: "micropdf417" }],
  // ["org.iso.MicroQR", { bcid: "microqrcode" }],
  // ["org.iso.DataMatrix", { bcid: "datamatrix" }],
]);

class ConfigError extends Error {}
class RequestError extends Error {}

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}, z.string().optional());

const requiredTrimmedString = (message: string) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(1, message),
  );

const passRequestSchema = z.object({
  code: requiredTrimmedString("Missing required 'code' value."),
  company: requiredTrimmedString("Missing required 'company' value."),
  detectedType: requiredTrimmedString("Missing required 'detectedType' value."),
  website: optionalTrimmedString,
});

type PassRequest = z.infer<typeof passRequestSchema>;

const runtimeConfig = await getRuntimeConfig();
console.log("Runtime configuration loaded successfully.");

const app = new Elysia()
  .get("/", () => ({
    service: "Walletify PKPass API",
    status: "ok",
  }))
  .get("/health", () => ({
    status: "ok",
  }))
  .post("/pass", async ({ body, set }) => handlePassRequest(body, set))
  .listen(Bun.env.PORT);

console.log(`Listening on ${app.server?.url}`);

async function handlePassRequest(
  payload: unknown,
  set: {
    status?: number | string;
    headers: Record<string, string | number>;
  },
) {
  try {
    const request = parsePassRequest(payload);
    const passBuffer = await buildPassBuffer(request);
    const serialNumber = buildSerialNumber(request);
    const headers = {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="walletify-${serialNumber}.pkpass"`,
      "content-type": APPLE_PKPASS_MIME,
    };

    return new Response(passBuffer, {
      headers,
      status: 200,
    });
  } catch (error) {
    if (error instanceof RequestError) {
      set.status = 400;
      return { error: error.message };
    }

    if (error instanceof ConfigError) {
      set.status = 500;
      return { error: error.message };
    }

    console.error("Failed to generate Wallet pass", error);
    set.status = 500;
    return { error: "Failed to generate Wallet pass." };
  }
}

function parsePassRequest(payload: unknown): PassRequest {
  const result = passRequestSchema.safeParse(payload);

  if (result.success) {
    return result.data;
  }

  const firstIssue = result.error.issues[0];
  if (firstIssue?.path[0] === "company") {
    throw new RequestError("Missing required 'company' value.");
  }

  if (firstIssue?.path[0] === "code") {
    throw new RequestError("Missing required 'code' value.");
  }

  if (firstIssue?.path[0] === "detectedType") {
    throw new RequestError("Missing required 'detectedType' value.");
  }

  throw new RequestError(
    "Invalid request payload. Expected non-empty 'company', 'code', and 'detectedType' values.",
  );
}

async function buildPassBuffer({
  company,
  code,
  detectedType,
  website,
}: PassRequest): Promise<Buffer> {
  console.log("Building pass for:", { company, code, website, detectedType });
  const groupingIdentifier = crypto.randomUUID();
  const serialNumber = buildSerialNumber({ company, code });
  const barcodeStrategy = resolveBarcodeStrategy(detectedType);
  console.log("Resolved barcode strategy:", barcodeStrategy);
  const stripAssets =
    barcodeStrategy.kind === "renderedStrip"
      ? await buildRenderedStripAssets({
          code,
          rendering: barcodeStrategy,
        })
      : undefined;
  const assets = await buildPassAssets(runtimeConfig.assets, {
    stripAssets,
    website,
  });
  const previewCode = truncate(code, 32);

  const pass = new PKPass(assets, runtimeConfig.certificates, {
    backgroundColor: runtimeConfig.colors.background,
    description: company,
    formatVersion: 1,
    foregroundColor: runtimeConfig.colors.foreground,
    groupingIdentifier,
    labelColor: runtimeConfig.colors.label,
    logoText: company,
    organizationName: company,
    passTypeIdentifier: runtimeConfig.passTypeIdentifier,
    serialNumber,
    teamIdentifier: runtimeConfig.teamIdentifier,
  });

  console.log(
    "Creating pass with serial number:",
    serialNumber,
    "and grouping identifier:",
    groupingIdentifier,
  );

  // Wallet groups generic and store-card passes that share a pass type.
  // Using event tickets with unique grouping identifiers keeps each saved pass separate.
  pass.type = "eventTicket";
  populateFrontFields(pass, {
    code,
  });
  populateBackFields(pass, {
    barcodeStrategy,
    code,
    company,
    website,
  });

  if (barcodeStrategy.kind === "native") {
    pass.setBarcodes(
      makePassBarcode({
        code,
        format: barcodeStrategy.format,
        previewCode,
      }),
    );
  }

  const passBuffer = pass.getAsBuffer();
  return passBuffer;
}

function buildSerialNumber({ company, code }: Pick<PassRequest, "code" | "company">): string {
  return new Bun.CryptoHasher("sha256").update(`${company}\n${code}`).digest("hex");
}

async function buildPassAssets(
  defaultAssets: Record<string, Buffer>,
  {
    stripAssets,
    website,
  }: {
    stripAssets?: Record<string, Buffer>;
    website?: string;
  },
): Promise<Record<string, Buffer>> {
  const assets = { ...defaultAssets };
  if (website) {
    const faviconAssets = await fetchFaviconAssets(website);
    if (faviconAssets) {
      Object.assign(assets, faviconAssets);
    }
  }

  if (stripAssets) {
    delete assets["thumbnail.png"];
    delete assets["thumbnail@2x.png"];
    delete assets["thumbnail@3x.png"];
    Object.assign(assets, stripAssets);
  }

  return assets;
}

function resolveBarcodeStrategy(detectedType: string): BarcodeStrategy {
  console.log("Detected barcode type:", detectedType);
  const normalizedType = detectedType.trim();
  const nativeFormat = NATIVE_WALLET_TYPES.get(normalizedType);
  if (nativeFormat) {
    return {
      format: nativeFormat,
      kind: "native",
    };
  }

  const renderedStrip = RENDERED_STRIP_TYPES.get(normalizedType);
  if (renderedStrip) {
    return {
      ...renderedStrip,
      kind: "renderedStrip",
    };
  }

  return {
    detectedType: normalizedType,
    kind: "unsupported",
  };
}

function populateFrontFields(pass: PKPass, { code }: { code: string }): void {
  pass.headerFields.push({
    key: "source",
    label: "Made with",
    textAlignment: "PKTextAlignmentRight",
    value: "Walletify",
  });
  pass.secondaryFields.push({
    key: "code",
    label: "Card number",
    value: code,
  });
}

function populateBackFields(
  pass: PKPass,
  {
    barcodeStrategy,
    code,
    company,
    website,
  }: {
    barcodeStrategy: BarcodeStrategy;
    code: string;
    company: string;
    website?: string;
  },
): void {
  pass.backFields.push({
    key: "companyName",
    label: "Company",
    value: company,
  });
  pass.backFields.push({
    key: "scannedCode",
    label: "Card number",
    value: code,
  });

  if (website) {
    pass.backFields.push({
      key: "website",
      label: "Website",
      value: normalizeWebsiteURL(website).toString(),
    });
  }

  if (barcodeStrategy.kind === "unsupported") {
    pass.backFields.push({
      key: "unsupportedBarcodeType",
      label: "Unsupported format",
      value: barcodeStrategy.detectedType,
    });
    pass.backFields.push({
      key: "unsupportedBarcodeNotice",
      label: "Notice",
      value:
        "Walletify could not recreate this barcode format automatically, so no Wallet barcode was generated.",
    });
  }

  pass.backFields.push({
    key: "walletifyNotice",
    label: "Notice",
    value: "Generated with Walletify",
  });
}

function makePassBarcode({
  code,
  format,
  previewCode,
}: {
  code: string;
  format: WalletBarcodeFormat;
  previewCode: string;
}) {
  return {
    altText: previewCode,
    format,
    message: code,
    messageEncoding: PASS_MESSAGE_ENCODING,
  };
}

async function buildRenderedStripAssets({
  code,
  rendering,
}: {
  code: string;
  rendering: Extract<BarcodeStrategy, { kind: "renderedStrip" }>;
}): Promise<Record<string, Buffer>> {
  const entries = await Promise.all(
    STRIP_RENDER_VARIANTS.map(
      async ({ filename, scale }) =>
        [
          filename,
          await renderStripBarcode({
            bcid: rendering.bcid,
            code,
            encoderOptions: rendering.encoderOptions,
            scale,
          }),
        ] as const,
    ),
  );

  return Object.fromEntries(entries);
}

async function renderStripBarcode({
  bcid,
  code,
  encoderOptions,
  scale,
}: {
  bcid: string;
  code: string;
  encoderOptions?: Record<string, boolean | number | string>;
  scale: number;
}): Promise<Buffer> {
  try {
    return await toBuffer({
      ...STRIP_RENDER_CONFIG,
      ...(encoderOptions ?? {}),
      bcid,
      scaleX: scale,
      scaleY: scale,
      text: code,
    });
  } catch (error) {
    throw new RequestError(
      `Could not recreate the detected barcode type '${bcid}' from the scanned value: ${stringifyError(error)}`,
    );
  }
}

async function fetchFaviconAssets(website: string): Promise<Record<string, Buffer> | undefined> {
  const normalizedWebsite = normalizeWebsiteURL(website);
  const faviconURL = new URL(FAVICON_SERVICE_URL);
  faviconURL.searchParams.set("domain_url", normalizedWebsite.origin);
  faviconURL.searchParams.set("sz", String(FAVICON_SIZE));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FAVICON_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(faviconURL, {
      headers: {
        "user-agent": "Walletify/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`Favicon lookup failed for ${normalizedWebsite.origin}: ${response.status}`);
      return undefined;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      console.warn(
        `Favicon lookup returned unsupported content type for ${normalizedWebsite.origin}: ${contentType}`,
      );
      return undefined;
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      return undefined;
    }

    const icon = Buffer.from(arrayBuffer);
    return {
      "logo.png": icon,
      "logo@2x.png": icon,
      "logo@3x.png": icon,
      "thumbnail.png": icon,
      "thumbnail@2x.png": icon,
      "thumbnail@3x.png": icon,
    };
  } catch (error) {
    console.warn(`Favicon lookup failed for ${normalizedWebsite.origin}: ${stringifyError(error)}`);
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeWebsiteURL(value: string): URL {
  const trimmedValue = value.trim();
  const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue}`;
  let websiteURL: URL;

  try {
    websiteURL = new URL(candidate);
  } catch {
    throw new RequestError("Invalid 'website' value. Provide a valid http or https URL.");
  }

  if (!["http:", "https:"].includes(websiteURL.protocol) || !websiteURL.hostname) {
    throw new RequestError("Invalid 'website' value. Provide a valid http or https URL.");
  }

  return websiteURL;
}

function truncate(value: string, length: number): string {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, length - 1)}…`;
}

async function getRuntimeConfig(): Promise<RuntimeConfig> {
  return loadRuntimeConfig();
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const assetPath = await resolvePassAssetPath();
  const [icon, icon2x, icon3x] = await Promise.all([
    readRequiredFile(`${assetPath}/icon.png`),
    readRequiredFile(`${assetPath}/icon@2x.png`),
    readRequiredFile(`${assetPath}/icon@3x.png`),
  ]);
  const wwdr = readCertificateFromEnv("WWDR_CERT", Bun.env.WWDR_CERT);
  const signerCert = readCertificateFromEnv("SIGNER_CERT", Bun.env.SIGNER_CERT);
  const signerKey = readCertificateFromEnv("SIGNER_KEY", Bun.env.SIGNER_KEY);

  return {
    assets: {
      "icon.png": icon,
      "icon@2x.png": icon2x,
      "icon@3x.png": icon3x,
    },
    certificates: {
      signerCert,
      signerKey,
      signerKeyPassphrase: Bun.env.SIGNER_KEY_PASSPHRASE,
      wwdr,
    },
    colors: {
      background: Bun.env.PASS_BACKGROUND_COLOR,
      foreground: Bun.env.PASS_FOREGROUND_COLOR,
      label: Bun.env.PASS_LABEL_COLOR,
    },
    organizationName: Bun.env.ORGANIZATION_NAME,
    passTypeIdentifier: Bun.env.PASS_TYPE_IDENTIFIER,
    teamIdentifier: Bun.env.TEAM_IDENTIFIER,
  };
}

async function readRequiredFile(filePath: string): Promise<Buffer> {
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    throw new ConfigError(`Missing required file at ${filePath}.`);
  }

  try {
    return Buffer.from(await file.arrayBuffer());
  } catch (error) {
    throw new ConfigError(`Failed reading required file at ${filePath}: ${stringifyError(error)}`);
  }
}

async function resolvePassAssetPath(): Promise<string> {
  for (const candidate of PASS_ASSET_CANDIDATES) {
    if (await Bun.file(`${candidate}/icon.png`).exists()) {
      console.log(`Found pass assets at: ${candidate}`);
      return candidate;
    }
  }

  throw new ConfigError(`Could not find pass assets. Checked: ${PASS_ASSET_CANDIDATES.join(", ")}`);
}

function readCertificateFromEnv(
  name: "SIGNER_CERT" | "SIGNER_KEY" | "WWDR_CERT",
  value: string,
): Buffer {
  try {
    return Buffer.from(value.replaceAll("\\n", "\n"), "utf8");
  } catch (error) {
    throw new ConfigError(
      `Failed reading certificate from environment variable ${name}: ${stringifyError(error)}`,
    );
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
