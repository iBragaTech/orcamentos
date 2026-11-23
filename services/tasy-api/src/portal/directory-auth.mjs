import { readFile } from "node:fs/promises";
import { Client, InvalidCredentialsError } from "ldapts";
import { ApiError } from "../errors.mjs";

export async function createDirectoryAuthenticator(env = process.env) {
  const configuredServer = (env.AD_SERVER || "").trim().replace(/\\+$/, "");
  const url = (env.PORTAL_AD_URL || (configuredServer ? `ldaps://${configuredServer}:636` : "")).trim();
  if (!url) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== "ldaps:") throw new Error("PORTAL_AD_URL deve usar LDAPS.");
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/")
    throw new Error("PORTAL_AD_URL deve conter somente o endereço LDAPS do servidor.");
  const tlsOptions = {
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    ...(env.PORTAL_AD_CA_FILE ? { ca: await readFile(env.PORTAL_AD_CA_FILE, "utf8") } : {}),
  };
  const upnSuffix = (env.AD_DOMAIN || env.PORTAL_AD_UPN_SUFFIX || "").trim();
  if (!upnSuffix) throw new Error("Configure PORTAL_AD_UPN_SUFFIX para habilitar o AD.");
  return async (username, password) => {
    const login = username.includes("@") ? username : `${username}@${upnSuffix}`;
    const client = new Client({ url, timeout: 8000, connectTimeout: 5000, tlsOptions });
    try {
      await client.bind(login, password);
      return true;
    } catch (error) {
      if (error instanceof InvalidCredentialsError) return false;
      throw new ApiError(
        503,
        "DIRECTORY_UNAVAILABLE",
        "Não foi possível validar o acesso na rede.",
      );
    } finally {
      await client.unbind().catch(() => {});
    }
  };
}
