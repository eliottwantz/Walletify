import { toBuffer } from "@bwip-js/node";
import { Elysia } from "elysia";
import { PKPass } from "passkit-generator";
import { z } from "zod";

console.log(`Using APP_ENV=${Bun.env.APP_ENV}`);

const APPLE_PKPASS_MIME = "application/vnd.apple.pkpass";
const HTML_MIME = "text/html; charset=utf-8";
const FAVICON_FETCH_TIMEOUT_MS = 5_000;
const FAVICON_SIZE = 256;
const FAVICON_SERVICE_URL = "https://www.google.com/s2/favicons";
const TUIST_BASE_URL = "https://tuist.dev";
const TUIST_ACCOUNT_HANDLE = "develiott";
const TUIST_PROJECT_HANDLE = "Walletify";
const DEFAULT_PREVIEWS_PAGE_SIZE = 12;
const MAX_PREVIEWS_PAGE_SIZE = 20;
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

type TuistPreview = {
  id: string;
  builds: Array<unknown>;
  bundle_identifier?: string;
  created_by?: {
    handle: string;
  };
  created_from_ci: boolean;
  device_url: string;
  display_name?: string;
  git_branch?: string;
  git_commit_sha?: string;
  icon_url: string;
  inserted_at: string;
  supported_platforms: string[];
  track?: string;
  url: string;
  version?: string;
};

type TuistPaginationMetadata = {
  current_page?: number | null;
  has_next_page: boolean;
  has_previous_page: boolean;
  page_size: number;
  total_count: number;
  total_pages?: number | null;
};

type TuistPreviewsResponse = {
  pagination_metadata: TuistPaginationMetadata;
  previews: TuistPreview[];
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

const tuistPreviewSchema = z.object({
  builds: z.array(z.unknown()),
  bundle_identifier: z.string().optional(),
  created_by: z
    .object({
      handle: z.string(),
    })
    .optional(),
  created_from_ci: z.boolean(),
  device_url: z.string(),
  display_name: z.string().optional(),
  git_branch: z.string().optional(),
  git_commit_sha: z.string().optional(),
  icon_url: z.string(),
  id: z.string(),
  inserted_at: z.string(),
  supported_platforms: z.array(z.string()),
  track: z.string().optional(),
  url: z.string(),
  version: z.string().optional(),
});

const tuistPreviewsResponseSchema = z.object({
  pagination_metadata: z.object({
    current_page: z.number().nullable().optional(),
    has_next_page: z.boolean(),
    has_previous_page: z.boolean(),
    page_size: z.number(),
    total_count: z.number(),
    total_pages: z.number().nullable().optional(),
  }),
  previews: z.array(tuistPreviewSchema),
});

type PassRequest = z.infer<typeof passRequestSchema>;

const runtimeConfig = await getRuntimeConfig();
console.log("Runtime configuration loaded successfully.");

const app = new Elysia()
  .get("/", async ({ request }) => handleIndexRequest(request))
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

async function handleIndexRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const page = parsePositiveInteger(url.searchParams.get("page"), 1);
  const pageSize = Math.min(
    parsePositiveInteger(url.searchParams.get("page_size"), DEFAULT_PREVIEWS_PAGE_SIZE),
    MAX_PREVIEWS_PAGE_SIZE,
  );

  try {
    const previewsResponse = await fetchTuistPreviews({ page, pageSize });

    return new Response(
      renderIndexPage({
        errorMessage: null,
        page,
        pageSize,
        pagination: previewsResponse.pagination_metadata,
        previews: previewsResponse.previews,
      }),
      {
        headers: {
          "cache-control": "no-store",
          "content-type": HTML_MIME,
        },
        status: 200,
      },
    );
  } catch (error) {
    console.error("Failed to load Tuist previews", error);

    return new Response(
      renderIndexPage({
        errorMessage: stringifyError(error),
        page,
        pageSize,
        pagination: {
          current_page: page,
          has_next_page: false,
          has_previous_page: page > 1,
          page_size: pageSize,
          total_count: 0,
          total_pages: 1,
        },
        previews: [],
      }),
      {
        headers: {
          "cache-control": "no-store",
          "content-type": HTML_MIME,
        },
        status: 503,
      },
    );
  }
}

async function fetchTuistPreviews({
  page,
  pageSize,
}: {
  page: number;
  pageSize: number;
}): Promise<TuistPreviewsResponse> {
  const token = Bun.env.TUIST_TOKEN?.trim();
  if (!token) {
    throw new ConfigError("Missing required TUIST_TOKEN for loading Tuist previews.");
  }

  const url = new URL(
    `${TUIST_BASE_URL}/api/projects/${TUIST_ACCOUNT_HANDLE}/${TUIST_PROJECT_HANDLE}/previews`,
  );
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const failureMessage = await readTuistErrorMessage(response);
    throw new RequestError(
      `Tuist previews request failed (${response.status}): ${failureMessage}`,
    );
  }

  const payload = await response.json();
  const parsedResponse = tuistPreviewsResponseSchema.safeParse(payload);
  if (!parsedResponse.success) {
    throw new RequestError("Tuist previews response had an unexpected shape.");
  }

  return parsedResponse.data;
}

async function readTuistErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof payload.message === "string"
    ) {
      return payload.message;
    }
  } catch {
    // Ignore body parse failures and fall back to status text.
  }

  return response.statusText || "Unknown error";
}

function renderIndexPage({
  errorMessage,
  page,
  pageSize,
  pagination,
  previews,
}: {
  errorMessage: string | null;
  page: number;
  pageSize: number;
  pagination: TuistPaginationMetadata;
  previews: TuistPreview[];
}): string {
  const currentPage = pagination.current_page ?? page;
  const totalPages = pagination.total_pages ?? Math.max(1, Math.ceil(pagination.total_count / pagination.page_size));
  const hasPreviews = previews.length > 0;

  const previewCards = hasPreviews
    ? previews.map((preview) => renderPreviewCard(preview)).join("\n")
    : `
      <div class="empty-state">
        <p class="eyebrow">Nothing to install yet</p>
        <h2>No previews on this page</h2>
        <p>Tuist has not returned any previews for page ${currentPage}. Try another page or upload a new preview.</p>
      </div>
    `;

  const errorBanner = errorMessage
    ? `
      <section class="banner banner-error">
        <p class="eyebrow">Preview feed unavailable</p>
        <h2>Could not load previews from Tuist</h2>
        <p>${escapeHtml(errorMessage)}</p>
      </section>
    `
    : "";

  const previousHref = buildPaginationHref(Math.max(1, currentPage - 1), pageSize);
  const nextHref = buildPaginationHref(currentPage + 1, pageSize);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Walletify Previews</title>
    <style>
      :root {
        color-scheme: light;
        --page-bg: linear-gradient(180deg, #faf3ea 0%, #f6f7fb 45%, #eef2f7 100%);
        --surface: rgba(255, 255, 255, 0.82);
        --surface-strong: rgba(255, 255, 255, 0.94);
        --surface-border: rgba(34, 52, 77, 0.09);
        --text: #213247;
        --muted: #67788d;
        --accent: #e1884c;
        --accent-deep: #c7652d;
        --accent-soft: rgba(225, 136, 76, 0.15);
        --shadow: 0 24px 60px rgba(28, 43, 61, 0.12);
        --radius-xl: 28px;
        --radius-lg: 22px;
        --radius-md: 16px;
        --font-sans: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: var(--page-bg);
        color: var(--text);
        font-family: var(--font-sans);
      }

      a {
        color: inherit;
        text-decoration: none;
      }

      .shell {
        width: min(1180px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 32px 0 56px;
      }

      .hero,
      .banner,
      .preview-card,
      .pagination {
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        background: var(--surface);
        border: 1px solid var(--surface-border);
        box-shadow: var(--shadow);
      }

      .hero {
        padding: 28px;
        border-radius: var(--radius-xl);
        margin-bottom: 20px;
        overflow: hidden;
        position: relative;
      }

      .hero::after {
        content: "";
        position: absolute;
        inset: auto -60px -90px auto;
        width: 220px;
        height: 220px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(225, 136, 76, 0.28), rgba(225, 136, 76, 0));
      }

      .eyebrow {
        margin: 0 0 10px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-size: 0.72rem;
        font-weight: 700;
        color: var(--accent-deep);
      }

      h1,
      h2,
      p {
        margin: 0;
      }

      .hero h1 {
        font-size: clamp(2rem, 4vw, 3.25rem);
        line-height: 1;
        margin-bottom: 12px;
        max-width: 12ch;
      }

      .hero p {
        max-width: 58ch;
        color: var(--muted);
        line-height: 1.6;
      }

      .hero-meta {
        margin-top: 22px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 999px;
        background: var(--surface-strong);
        border: 1px solid rgba(34, 52, 77, 0.08);
        color: var(--muted);
        font-size: 0.92rem;
      }

      .banner {
        border-radius: var(--radius-lg);
        padding: 22px;
        margin-bottom: 20px;
      }

      .banner-error {
        border-color: rgba(190, 76, 65, 0.25);
        background: rgba(255, 244, 242, 0.9);
      }

      .banner h2 {
        margin-bottom: 8px;
      }

      .banner p:last-child {
        color: var(--muted);
        line-height: 1.6;
      }

      .preview-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
        gap: 18px;
      }

      .preview-card {
        border-radius: var(--radius-lg);
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }

      .preview-card-top {
        display: flex;
        align-items: center;
        gap: 14px;
      }

      .preview-icon {
        width: 64px;
        height: 64px;
        border-radius: 18px;
        object-fit: cover;
        background: linear-gradient(135deg, rgba(225, 136, 76, 0.18), rgba(70, 105, 147, 0.12));
        border: 1px solid rgba(34, 52, 77, 0.08);
        flex-shrink: 0;
      }

      .preview-title {
        font-size: 1.2rem;
        line-height: 1.2;
        margin-bottom: 6px;
      }

      .preview-subtitle {
        color: var(--muted);
        font-size: 0.95rem;
      }

      .tag-row,
      .meta-list,
      .card-actions,
      .pagination {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .tag {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 11px;
        border-radius: 999px;
        font-size: 0.83rem;
        background: var(--accent-soft);
        color: var(--accent-deep);
      }

      .meta-list {
        flex-direction: column;
        gap: 8px;
      }

      .meta-item {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 0.92rem;
      }

      .meta-item dt {
        color: var(--muted);
      }

      .meta-item dd {
        margin: 0;
        text-align: right;
        font-weight: 600;
      }

      .meta-item dd.code {
        font-family: "SFMono-Regular", "Menlo", "Monaco", monospace;
        font-size: 0.8rem;
      }

      .card-actions {
        margin-top: auto;
      }

      .button,
      .button-secondary,
      .pagination a,
      .pagination span {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 16px;
        border-radius: 999px;
        font-weight: 700;
      }

      .button {
        background: linear-gradient(135deg, var(--accent) 0%, var(--accent-deep) 100%);
        color: white;
      }

      .button-secondary,
      .pagination a,
      .pagination span {
        background: var(--surface-strong);
        border: 1px solid rgba(34, 52, 77, 0.08);
        color: var(--text);
      }

      .pagination {
        margin-top: 22px;
        border-radius: var(--radius-lg);
        padding: 14px;
        justify-content: space-between;
        align-items: center;
      }

      .pagination-info {
        color: var(--muted);
        font-size: 0.94rem;
      }

      .pagination-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .pagination span[aria-disabled="true"] {
        opacity: 0.45;
      }

      .empty-state {
        padding: 34px;
        border-radius: var(--radius-lg);
        background: rgba(255, 255, 255, 0.68);
        border: 1px dashed rgba(34, 52, 77, 0.16);
      }

      .empty-state h2 {
        margin-bottom: 8px;
      }

      .empty-state p:last-child {
        color: var(--muted);
        line-height: 1.6;
      }

      @media (max-width: 720px) {
        .shell {
          width: min(100vw - 20px, 1180px);
          padding: 18px 0 36px;
        }

        .hero,
        .banner,
        .preview-card,
        .pagination,
        .empty-state {
          border-radius: 20px;
        }

        .pagination {
          flex-direction: column;
          align-items: stretch;
        }

        .pagination-controls {
          justify-content: stretch;
        }

        .pagination-controls a,
        .pagination-controls span {
          flex: 1 1 0;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <p class="eyebrow">Walletify distribution</p>
        <h1>Install the latest previews from Tuist.</h1>
        <p>Browse every uploaded preview, page through older builds, and install directly on device with a single tap.</p>
        <div class="hero-meta">
          <span class="pill">${pagination.total_count} total previews</span>
          <span class="pill">Page ${currentPage} of ${totalPages}</span>
          <span class="pill">${pagination.page_size} per page</span>
        </div>
      </section>
      ${errorBanner}
      <section class="preview-grid">
        ${previewCards}
      </section>
      <nav class="pagination" aria-label="Pagination">
        <p class="pagination-info">Showing page ${currentPage} with ${pagination.page_size} previews per page.</p>
        <div class="pagination-controls">
          ${pagination.has_previous_page ? `<a href="${previousHref}">Previous</a>` : `<span aria-disabled="true">Previous</span>`}
          ${pagination.has_next_page ? `<a href="${nextHref}">Next</a>` : `<span aria-disabled="true">Next</span>`}
        </div>
      </nav>
    </main>
  </body>
</html>`;
}

function renderPreviewCard(preview: TuistPreview): string {
  const title = preview.display_name || preview.bundle_identifier || "Untitled preview";
  const version = preview.version || "Unknown version";
  const branch = preview.git_branch || "No branch";
  const shortCommit = preview.git_commit_sha ? preview.git_commit_sha.slice(0, 7) : "-";
  const uploader = preview.created_by?.handle || (preview.created_from_ci ? "CI" : "Unknown");
  const platformTags = preview.supported_platforms.map((platform) => {
    return `<span class="tag">${escapeHtml(formatPlatformLabel(platform))}</span>`;
  });

  if (preview.created_from_ci) {
    platformTags.unshift('<span class="tag">CI</span>');
  }

  if (preview.track) {
    platformTags.push(`<span class="tag">Track: ${escapeHtml(preview.track)}</span>`);
  }

  return `
    <article class="preview-card">
      <div class="preview-card-top">
        <img class="preview-icon" src="${escapeHtml(preview.icon_url)}" alt="${escapeHtml(title)} icon" loading="lazy" />
        <div>
          <h2 class="preview-title">${escapeHtml(title)}</h2>
          <p class="preview-subtitle">${escapeHtml(version)}</p>
        </div>
      </div>
      <div class="tag-row">
        ${platformTags.join("\n")}
      </div>
      <dl class="meta-list">
        <div class="meta-item">
          <dt>Bundle ID</dt>
          <dd>${escapeHtml(preview.bundle_identifier || "-")}</dd>
        </div>
        <div class="meta-item">
          <dt>Branch</dt>
          <dd>${escapeHtml(branch)}</dd>
        </div>
        <div class="meta-item">
          <dt>Commit</dt>
          <dd class="code">${escapeHtml(shortCommit)}</dd>
        </div>
        <div class="meta-item">
          <dt>Uploaded</dt>
          <dd>${escapeHtml(formatPreviewDate(preview.inserted_at))}</dd>
        </div>
        <div class="meta-item">
          <dt>By</dt>
          <dd>${escapeHtml(uploader)}</dd>
        </div>
      </dl>
      <div class="card-actions">
        <a class="button" href="${escapeHtml(preview.device_url)}">Install</a>
        <a class="button-secondary" href="${escapeHtml(preview.url)}">Open in Tuist</a>
      </div>
    </article>
  `;
}

function buildPaginationHref(page: number, pageSize: number): string {
  const search = new URLSearchParams();
  search.set("page", String(page));

  if (pageSize !== DEFAULT_PREVIEWS_PAGE_SIZE) {
    search.set("page_size", String(pageSize));
  }

  return `/?${search.toString()}`;
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallback;
  }

  return parsedValue;
}

function formatPreviewDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatPlatformLabel(platform: string): string {
  return platform
    .split("_")
    .map((segment) => {
      if (segment === "ios" || segment === "tvos") {
        return segment.toUpperCase();
      }

      if (segment === "visionos") {
        return "visionOS";
      }

      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
