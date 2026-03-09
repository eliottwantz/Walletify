# PKPassAPI

Minimal Bun/Elysia backend for generating signed Apple Wallet passes for Walletify.

## Endpoints

- `GET /health`
- `GET /pass?company=Acme&code=12345`
- `POST /pass`

`POST /pass` body:

```json
{
  "company": "Acme",
  "code": "12345",
  "website": "https://acme.example"
}
```

`website` is optional. When present, the API attempts to use the site's favicon as the pass logo image. If no website is provided, or no favicon is resolved, the pass is generated without a logo image.

Successful responses return a `.pkpass` payload with content type `application/vnd.apple.pkpass`.

## Run Locally

1. Install dependencies:

```bash
bun install
```

2. Copy the example env file and fill in your Apple Wallet values:

```bash
cp .env.example .env
```

3. Add signing files to `./certs` or provide them by env var.

Required env values:

- `ORGANIZATION_NAME`
- `TEAM_IDENTIFIER`
- `PASS_TYPE_IDENTIFIER`
- `WWDR_CERT_PATH` or `WWDR_CERT_BASE64` or `WWDR_CERT_PEM`
- `SIGNER_CERT_PATH` or `SIGNER_CERT_BASE64` or `SIGNER_CERT_PEM`
- `SIGNER_KEY_PATH` or `SIGNER_KEY_BASE64` or `SIGNER_KEY_PEM`

Optional env values:

- `PORT`
- `PASS_DESCRIPTION`
- `PASS_BACKGROUND_COLOR`
- `PASS_FOREGROUND_COLOR`
- `PASS_LABEL_COLOR`
- `SIGNER_KEY_PASSPHRASE`

4. Start the server:

```bash
bun run start
```

## Certificate Notes

The backend expects PEM files for:

- Apple WWDR certificate
- Wallet Pass signer certificate
- Wallet Pass signer private key

If Apple exported your signer cert as `.p12`, extract PEM files first. Example:

```bash
openssl pkcs12 -in signer.p12 -clcerts -nokeys -out certs/signerCert.pem
openssl pkcs12 -in signer.p12 -nocerts -out certs/signerKey.pem
```

Export the Apple WWDR certificate to `certs/wwdr.pem` as PEM as well.

## Deploy

The iOS app is configured to call:

- `https://api.walletify.develiott.com/pass`

Deploy this service there with the required environment variables and certificate material. No authentication is included yet.
