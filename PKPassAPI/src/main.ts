import { Elysia } from "elysia";
import { PKPass } from "passkit-generator";
import { z } from "zod";

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
const DEFAULT_CERTS_PATH = `${RUNTIME_ROOT}/certs`;
const DEFAULT_PORT = 8080;
const DEFAULT_PASS_COLORS = {
	background: "rgb(17, 24, 39)",
	foreground: "rgb(255, 255, 255)",
	label: "rgb(156, 163, 175)",
} as const;

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
	website: optionalTrimmedString,
});

type PassRequest = z.infer<typeof passRequestSchema>;

const runtimeEnvSchema = z.object({
	ORGANIZATION_NAME: requiredTrimmedString(
		"Missing required environment variable ORGANIZATION_NAME.",
	),
	PASS_BACKGROUND_COLOR: optionalTrimmedString.default(
		DEFAULT_PASS_COLORS.background,
	),
	PASS_FOREGROUND_COLOR: optionalTrimmedString.default(
		DEFAULT_PASS_COLORS.foreground,
	),
	PASS_LABEL_COLOR: optionalTrimmedString.default(DEFAULT_PASS_COLORS.label),
	PASS_TYPE_IDENTIFIER: requiredTrimmedString(
		"Missing required environment variable PASS_TYPE_IDENTIFIER.",
	),
	PORT: z.preprocess((value) => {
		if (typeof value !== "string") {
			return value;
		}

		const trimmed = value.trim();
		return trimmed === "" ? undefined : Number(trimmed);
	}, z.number().int().min(1).max(65535).default(DEFAULT_PORT)),
	SIGNER_CERT_BASE64: optionalTrimmedString,
	SIGNER_CERT_PATH: optionalTrimmedString,
	SIGNER_CERT_PEM: optionalTrimmedString,
	SIGNER_KEY_BASE64: optionalTrimmedString,
	SIGNER_KEY_PASSPHRASE: optionalTrimmedString,
	SIGNER_KEY_PATH: optionalTrimmedString,
	SIGNER_KEY_PEM: optionalTrimmedString,
	TEAM_IDENTIFIER: requiredTrimmedString(
		"Missing required environment variable TEAM_IDENTIFIER.",
	),
	WWDR_CERT_BASE64: optionalTrimmedString,
	WWDR_CERT_PATH: optionalTrimmedString,
	WWDR_CERT_PEM: optionalTrimmedString,
});

type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;
type CertificateEnvKey =
	| "SIGNER_CERT_BASE64"
	| "SIGNER_CERT_PATH"
	| "SIGNER_CERT_PEM"
	| "SIGNER_KEY_BASE64"
	| "SIGNER_KEY_PATH"
	| "SIGNER_KEY_PEM"
	| "WWDR_CERT_BASE64"
	| "WWDR_CERT_PATH"
	| "WWDR_CERT_PEM";

const runtimeEnv = parseRuntimeEnv(Bun.env);
const runtimeConfig = await getRuntimeConfig();

const app = new Elysia()
	.get("/", () => ({
		service: "Walletify PKPass API",
		status: "ok",
	}))
	.get("/health", () => ({
		status: "ok",
	}))
	.get("/pass", async ({ query, set }) => {
		return handlePassRequest(
			{
				company: query.company,
				code: query.code,
				website: query.website,
			},
			set,
		);
	})
	.post("/pass", async ({ body, set }) => handlePassRequest(body, set))
	.listen(runtimeEnv.PORT);

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

	throw new RequestError(
		"Invalid request payload. Expected non-empty 'company' and 'code' values.",
	);
}

async function buildPassBuffer({
	company,
	code,
	website,
}: PassRequest): Promise<Buffer> {
	const serialNumber = buildSerialNumber({ company, code, website });
	const organizationName = "Walletify";
	const assets = await buildPassAssets(runtimeConfig.assets, website);
	const previewCode = truncate(code, 32);

	const pass = new PKPass(assets, runtimeConfig.certificates, {
		backgroundColor: runtimeConfig.colors.background,
		description: `${company} pass`,
		formatVersion: 1,
		foregroundColor: runtimeConfig.colors.foreground,
		labelColor: runtimeConfig.colors.label,
		logoText: `Generated with ${organizationName}`,
		organizationName,
		passTypeIdentifier: runtimeConfig.passTypeIdentifier,
		serialNumber,
		teamIdentifier: runtimeConfig.teamIdentifier,
	});

	pass.type = "generic";
	pass.primaryFields.push({
		key: "company",
		label: "Company",
		value: company,
	});
	pass.backFields.push({
		key: "companyName",
		label: "Company",
		value: company,
	});
	pass.backFields.push({
		key: "scannedCode",
		label: "Scanned value",
		value: code,
	});
	if (website) {
		pass.backFields.push({
			key: "website",
			label: "Website",
			value: normalizeWebsiteURL(website).toString(),
		});
	}
	pass.backFields.push({
		key: "walletifyNotice",
		label: "Notice",
		value:
			"This is a user-generated Wallet pass created from a scanned QR or barcode.",
	});
	pass.setBarcodes(
		{
			altText: previewCode,
			format: "PKBarcodeFormatQR",
			message: code,
		},
		{
			altText: previewCode,
			format: "PKBarcodeFormatPDF417",
			message: code,
		},
		{
			altText: previewCode,
			format: "PKBarcodeFormatAztec",
			message: code,
		},
		{
			altText: previewCode,
			format: "PKBarcodeFormatCode128",
			message: code,
		},
	);

	return pass.getAsBuffer();
}

function buildSerialNumber({ company, code, website }: PassRequest): string {
	return new Bun.CryptoHasher("sha256")
		.update(`${company}\n${code}\n${normalizeWebsiteForSerialNumber(website)}`)
		.digest("hex");
}

async function buildPassAssets(
	defaultAssets: Record<string, Buffer>,
	website?: string,
): Promise<Record<string, Buffer>> {
	if (!website) {
		return defaultAssets;
	}

	const faviconAssets = await fetchFaviconAssets(website);
	if (!faviconAssets) {
		return withoutThumbnailAssets(defaultAssets);
	}

	return {
		...defaultAssets,
		...faviconAssets,
	};
}

function withoutThumbnailAssets(
	assets: Record<string, Buffer>,
): Record<string, Buffer> {
	const {
		"thumbnail.png": _thumbnail,
		"thumbnail@2x.png": _thumbnail2x,
		"thumbnail@3x.png": _thumbnail3x,
		...assetsWithoutThumbnail
	} = assets;

	return assetsWithoutThumbnail;
}

async function fetchFaviconAssets(
	website: string,
): Promise<Record<string, Buffer> | undefined> {
	const normalizedWebsite = normalizeWebsiteURL(website);
	const faviconURL = new URL(FAVICON_SERVICE_URL);
	faviconURL.searchParams.set("domain_url", normalizedWebsite.origin);
	faviconURL.searchParams.set("sz", String(FAVICON_SIZE));

	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		FAVICON_FETCH_TIMEOUT_MS,
	);

	try {
		const response = await fetch(faviconURL, {
			headers: {
				"user-agent": "Walletify/1.0",
			},
			signal: controller.signal,
		});

		if (!response.ok) {
			console.warn(
				`Favicon lookup failed for ${normalizedWebsite.origin}: ${response.status}`,
			);
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
			"thumbnail.png": icon,
			"thumbnail@2x.png": icon,
			"thumbnail@3x.png": icon,
		};
	} catch (error) {
		console.warn(
			`Favicon lookup failed for ${normalizedWebsite.origin}: ${stringifyError(error)}`,
		);
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
		throw new RequestError(
			"Invalid 'website' value. Provide a valid http or https URL.",
		);
	}

	if (
		!["http:", "https:"].includes(websiteURL.protocol) ||
		!websiteURL.hostname
	) {
		throw new RequestError(
			"Invalid 'website' value. Provide a valid http or https URL.",
		);
	}

	return websiteURL;
}

function normalizeWebsiteForSerialNumber(website?: string): string {
	if (!website) {
		return "";
	}

	return normalizeWebsiteURL(website).origin;
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
	const [
		icon,
		icon2x,
		icon3x,
		thumbnail,
		thumbnail2x,
		thumbnail3x,
		wwdr,
		signerCert,
		signerKey,
	] = await Promise.all([
		readRequiredFile(`${assetPath}/icon.png`),
		readRequiredFile(`${assetPath}/icon@2x.png`),
		readRequiredFile(`${assetPath}/icon@3x.png`),
		readRequiredFile(`${assetPath}/thumbnail.png`),
		readRequiredFile(`${assetPath}/thumbnail@2x.png`),
		readRequiredFile(`${assetPath}/thumbnail@3x.png`),
		readCertificate({
			env: runtimeEnv,
			base64Env: "WWDR_CERT_BASE64",
			defaultPath: `${DEFAULT_CERTS_PATH}/wwdr.pem`,
			pathEnv: "WWDR_CERT_PATH",
			rawEnv: "WWDR_CERT_PEM",
		}),
		readCertificate({
			env: runtimeEnv,
			base64Env: "SIGNER_CERT_BASE64",
			defaultPath: `${DEFAULT_CERTS_PATH}/signerCert.pem`,
			pathEnv: "SIGNER_CERT_PATH",
			rawEnv: "SIGNER_CERT_PEM",
		}),
		readCertificate({
			env: runtimeEnv,
			base64Env: "SIGNER_KEY_BASE64",
			defaultPath: `${DEFAULT_CERTS_PATH}/signerKey.pem`,
			pathEnv: "SIGNER_KEY_PATH",
			rawEnv: "SIGNER_KEY_PEM",
		}),
	]);

	return {
		assets: {
			"icon.png": icon,
			"icon@2x.png": icon2x,
			"icon@3x.png": icon3x,
			"logo.png": thumbnail,
			"logo@2x.png": thumbnail2x,
			"logo@3x.png": thumbnail3x,
		},
		certificates: {
			signerCert,
			signerKey,
			signerKeyPassphrase: runtimeEnv.SIGNER_KEY_PASSPHRASE,
			wwdr,
		},
		colors: {
			background: runtimeEnv.PASS_BACKGROUND_COLOR,
			foreground: runtimeEnv.PASS_FOREGROUND_COLOR,
			label: runtimeEnv.PASS_LABEL_COLOR,
		},
		organizationName: runtimeEnv.ORGANIZATION_NAME,
		passTypeIdentifier: runtimeEnv.PASS_TYPE_IDENTIFIER,
		teamIdentifier: runtimeEnv.TEAM_IDENTIFIER,
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
		throw new ConfigError(
			`Failed reading required file at ${filePath}: ${stringifyError(error)}`,
		);
	}
}

async function resolvePassAssetPath(): Promise<string> {
	for (const candidate of PASS_ASSET_CANDIDATES) {
		if (await Bun.file(`${candidate}/icon.png`).exists()) {
			return candidate;
		}
	}

	throw new ConfigError(
		`Could not find pass assets. Checked: ${PASS_ASSET_CANDIDATES.join(", ")}`,
	);
}

async function readCertificate({
	env,
	base64Env,
	defaultPath,
	pathEnv,
	rawEnv,
}: {
	env: RuntimeEnv;
	base64Env: CertificateEnvKey;
	defaultPath: string;
	pathEnv: CertificateEnvKey;
	rawEnv: CertificateEnvKey;
}): Promise<Buffer> {
	const base64Value = env[base64Env];
	if (base64Value) {
		return Buffer.from(base64Value, "base64");
	}

	const rawValue = env[rawEnv];
	if (rawValue) {
		return Buffer.from(rawValue.replaceAll("\\n", "\n"), "utf8");
	}

	const configuredPath = env[pathEnv] || defaultPath;
	return readRequiredFile(configuredPath);
}

function parseRuntimeEnv(env: Record<string, string | undefined>): RuntimeEnv {
	const result = runtimeEnvSchema.safeParse(env);

	if (result.success) {
		return result.data;
	}

	const firstIssue = result.error.issues[0];
	if (!firstIssue) {
		throw new ConfigError("Invalid environment configuration.");
	}

	const field = firstIssue.path[0];

	if (field === "PORT") {
		throw new ConfigError(
			"Environment variable PORT must be an integer between 1 and 65535.",
		);
	}

	if (typeof field === "string") {
		throw new ConfigError(firstIssue.message);
	}

	throw new ConfigError("Invalid environment configuration.");
}

function stringifyError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}
