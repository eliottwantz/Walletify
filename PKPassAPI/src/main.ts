import { Elysia } from "elysia";
import { PKPass } from "passkit-generator";
import { z } from "zod";

const APPLE_PKPASS_MIME = "application/vnd.apple.pkpass";
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

const optionalTrimmedString = z.preprocess(
	(value) => {
		if (typeof value !== "string") {
			return value;
		}

		const trimmed = value.trim();
		return trimmed === "" ? undefined : trimmed;
	},
	z.string().optional(),
);

const requiredTrimmedString = (message: string) =>
	z.preprocess(
		(value) => (typeof value === "string" ? value.trim() : value),
		z.string().min(1, message),
	);

const passRequestSchema = z.object({
	code: requiredTrimmedString("Missing required 'code' value."),
	company: requiredTrimmedString("Missing required 'company' value."),
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
	PORT: z.preprocess(
		(value) => {
			if (typeof value !== "string") {
				return value;
			}

			const trimmed = value.trim();
			return trimmed === "" ? undefined : Number(trimmed);
		},
		z.number().int().min(1).max(65535).default(DEFAULT_PORT),
	),
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

let runtimeConfigPromise: Promise<RuntimeConfig> | undefined;

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
}: PassRequest): Promise<Buffer> {
	const config = await getRuntimeConfig();
	const serialNumber = buildSerialNumber({ company, code });
	const organizationName = "Walletify";

	const pass = new PKPass(
		config.assets,
		config.certificates,
		{
			backgroundColor: config.colors.background,
			description: `${company} card in Walletify`,
			formatVersion: 1,
			foregroundColor: config.colors.foreground,
			labelColor: config.colors.label,
			logoText: organizationName,
			organizationName,
			passTypeIdentifier: config.passTypeIdentifier,
			serialNumber,
			teamIdentifier: config.teamIdentifier,
		},
	);

	pass.type = "generic";
	pass.primaryFields.push({
		key: "company",
		label: "Company",
		value: company,
	});
	pass.secondaryFields.push({
		key: "codeLabel",
		label: "Type",
		value: "Scanned Code",
	});
	pass.auxiliaryFields.push({
		key: "codePreview",
		label: "Preview",
		value: truncate(code, 32),
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
	pass.backFields.push({
		key: "walletifyNotice",
		label: "Notice",
		value:
			"This is a user-generated Wallet pass created from a scanned QR or barcode.",
	});
	pass.setBarcodes(code);

	return pass.getAsBuffer();
}

function buildSerialNumber({ company, code }: PassRequest): string {
	return new Bun.CryptoHasher("sha256")
		.update(`${company}\n${code}`)
		.digest("hex");
}

function truncate(value: string, length: number): string {
	if (value.length <= length) {
		return value;
	}

	return `${value.slice(0, length - 1)}…`;
}

async function getRuntimeConfig(): Promise<RuntimeConfig> {
	runtimeConfigPromise ??= loadRuntimeConfig();
	return runtimeConfigPromise;
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
	] =
		await Promise.all([
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
			// "icon.png": icon,
			// "icon@2x.png": icon2x,
			// "icon@3x.png": icon3x,
			"thumbnail.png": thumbnail,
			"thumbnail@2x.png": thumbnail2x,
			"thumbnail@3x.png": thumbnail3x,
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
