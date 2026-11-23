import { readFile } from "node:fs/promises";
import { getCACertificates } from "node:tls";
import { Client, InvalidCredentialsError } from "ldapts";
import { ApiError } from "../errors.mjs";

export async function createDirectoryAuthenticator(env = process.env) {
  const configuredServer = (env.AD_SERVER || "").trim().replace(/\\+$/, "");
  const url = (
    env.PORTAL_AD_URL || (configuredServer ? `ldaps://${configuredServer}:636` : "")
  ).trim();
  if (!url) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== "ldaps:") throw new Error("PORTAL_AD_URL deve usar LDAPS.");
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "" && parsed.pathname !== "/")
  )
    throw new Error("AD_SERVER deve conter somente o nome do controlador de domínio.");
  const ca = [
    ...getCACertificates("default"),
    ...getCACertificates("system"),
    ...(env.PORTAL_AD_CA_FILE ? [await readFile(env.PORTAL_AD_CA_FILE, "utf8")] : []),
  ];
  const tlsOptions = {
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    ca,
  };
  const upnSuffix = (env.AD_DOMAIN || env.PORTAL_AD_UPN_SUFFIX || "").trim();
  if (!upnSuffix) throw new Error("Configure PORTAL_AD_UPN_SUFFIX para habilitar o AD.");
  return async (username, password, suppliedLogin) => {
    const supplied = String(suppliedLogin ?? "").trim();
    const suppliedSam = supplied.split("\\").at(-1).split("@")[0];
    // Honor an explicitly supplied UPN/DOMAIN\\user only when it names the
    // same sAMAccountName already registered for this portal account.
    const suppliedIsQualified = supplied.includes("@") || supplied.includes("\\");
    const bindLogin =
      suppliedIsQualified && suppliedSam.toLowerCase() === username.toLowerCase()
        ? supplied
        : username.includes("@")
          ? username
          : `${username}@${upnSuffix}`;
    const client = new Client({ url, timeout: 8000, connectTimeout: 5000, tlsOptions });
    try {
      await client.bind(bindLogin, password);
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
