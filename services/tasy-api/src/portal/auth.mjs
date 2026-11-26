import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { ApiError } from "../errors.mjs";
const scrypt = promisify(scryptCallback);
const digest = (token) => createHash("sha256").update(token).digest("hex");
export const passwordSchema = z.string().min(12).max(128);
export const userSchema = z
  .object({
    nome: z.string().trim().min(1).max(120),
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    perfil: z.enum(["Administrador", "Comercial", "Médico", "Custos"]),
    authSource: z.enum(["portal", "ad"]).default("portal"),
    adLogin: z.string().trim().min(1).max(254).optional(),
    senha: passwordSchema.optional(),
  })
  .strict();
export function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const messages = {
      nome: "Nome: informe de 1 a 120 caracteres.",
      email: "E-mail: informe um endereço válido, com até 254 caracteres.",
      perfil: "Perfil inválido. Selecione Administrador, Comercial, Médico ou Custos.",
      senha: "Senha inicial: informe de 12 a 128 caracteres.",
      nmUsuario: "Usuário Tasy (NM_USUARIO): informe de 1 a 15 caracteres.",
      cdPerfil: "Código do perfil Tasy: informe um número inteiro positivo válido.",
      cdEstabelecimento: "Código do estabelecimento: informe um número inteiro positivo válido.",
    };
    const field = result.error.issues[0]?.path[0];
    throw new ApiError(
      400,
      "INVALID_INPUT",
      Object.hasOwn(messages, field)
        ? messages[field]
        : "Dados inválidos. Confira os campos obrigatórios e os valores informados.",
    );
  }
  return result.data;
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString("hex")}`;
}
async function verify(password, encoded) {
  const [, salt, hex] = encoded.split(":");
  const key = await scrypt(password, salt, 64);
  const stored = Buffer.from(hex, "hex");
  return key.length === stored.length && timingSafeEqual(key, stored);
}
export function publicUser(user) {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email ?? "",
    perfil: user.perfil,
    needsTasyLink: user.auth_source === "ad" && user.tasy_linked !== true,
    needsPortalApproval: user.auth_source === "ad" && user.portal_access_ready !== true,
    authSource: user.auth_source,
    tasyLinked: user.tasy_linked === true,
  };
}
export async function createUser(db, input) {
  const user = parse(userSchema, input);
  if (user.authSource === "portal" && !user.senha)
    throw new ApiError(400, "INVALID_INPUT", "Informe a senha inicial da conta do portal.");
  if (user.authSource === "ad" && !user.adLogin)
    throw new ApiError(400, "INVALID_INPUT", "Informe o usuário de rede (AD).");
  const hashed = user.senha ? await hashPassword(user.senha) : null;
  const result = await db.query(
    `INSERT INTO portal.users(nome,email,perfil,password_hash,auth_source,ad_login)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,nome,email,perfil`,
    [
      user.nome,
      user.email,
      user.perfil,
      hashed,
      user.authSource,
      user.authSource === "ad" ? user.adLogin.toLowerCase() : null,
    ],
  );
  return result.rows[0];
}
export async function createLocalAuth(db, { authenticateDirectory } = {}) {
  const dummyHash = await hashPassword(randomBytes(24).toString("hex"));
  const loginSchema = z
    .object({ email: z.string().trim().min(1).max(254), senha: z.string().min(1).max(128) })
    .strict();
  return {
    login: async (body) => {
      const { email: login, senha } = parse(loginSchema, body);
      const normalizedLogin = login.toLowerCase();
      const directorySam = normalizedLogin.split("\\").at(-1).split("@")[0];
      const { rows } = await db.query(
        `SELECT * FROM portal.users WHERE ativo=true AND
        (email=$1 OR ad_login=$1 OR (auth_source='ad' AND ad_login=$2))`,
        [normalizedLogin, directorySam],
      );
      if (rows.length > 1)
        throw new ApiError(401, "UNAUTHORIZED", "E-mail ou senha inválidos.");
      let user = rows.length === 1 ? rows[0] : null;
      let valid = false;
      if (user?.auth_source === "ad") {
        if (!authenticateDirectory)
          throw new ApiError(
            503,
            "DIRECTORY_DISABLED",
            "A autenticação pela rede ainda não está configurada.",
          );
        valid = await authenticateDirectory(user.ad_login, senha, login);
      } else if (!user) {
        if (!authenticateDirectory)
          throw new ApiError(503, "DIRECTORY_DISABLED", "A autenticação pela rede ainda não está configurada.");
        if (!directorySam || directorySam.length > 15 || !/^[a-z0-9._-]+$/i.test(directorySam))
          throw new ApiError(401, "UNAUTHORIZED", "E-mail ou senha inválidos.");
        valid = await authenticateDirectory(directorySam, senha, login);
        if (valid) {
          const created = await db.query(
            `INSERT INTO portal.users(nome,email,perfil,password_hash,auth_source,ad_login,portal_access_ready)
            VALUES ($1,NULL,'Comercial',NULL,'ad',$2,false)
            ON CONFLICT (ad_login) DO NOTHING RETURNING *`,
            [directorySam, directorySam],
          );
          if (created.rows.length) user = created.rows[0];
          else {
            const existing = await db.query(
              "SELECT * FROM portal.users WHERE ad_login=$1",
              [directorySam],
            );
            user = existing.rows[0] ?? null;
          }
          if (!user?.ativo) valid = false;
        }
      } else {
        valid =
          user &&
          user.email === normalizedLogin &&
          (await verify(senha, user.password_hash || dummyHash));
      }
      if (!user?.ativo || !valid)
        throw new ApiError(401, "UNAUTHORIZED", "E-mail ou senha inválidos.");
      const token = randomBytes(32).toString("base64url");
      await db.transaction(async (tx) => {
        await tx.query("DELETE FROM portal.sessions WHERE expires_at <= now()");
        await tx.query(
          "INSERT INTO portal.sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now() + interval '8 hours')",
          [digest(token), user.id],
        );
        await tx.query("UPDATE portal.users SET ultimo_acesso = now() WHERE id = $1", [user.id]);
      });
      const link = await db.query(
        "SELECT EXISTS(SELECT 1 FROM portal.tasy_user_links WHERE user_id=$1) AS tasy_linked",
        [user.id],
      );
      return { token, user: publicUser({ ...user, tasy_linked: link.rows[0].tasy_linked }) };
    },
    authenticate: async (header) => {
      if (typeof header !== "string" || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) {
        throw new ApiError(401, "UNAUTHORIZED", "Autenticação necessária.");
      }
      const tokenHash = digest(header.slice(7));
      const { rows } = await db.query(
        `SELECT u.id,u.nome,u.email,u.perfil,u.auth_source,u.ad_login,u.portal_access_ready,
        EXISTS(SELECT 1 FROM portal.tasy_user_links l WHERE l.user_id=u.id) AS tasy_linked
        FROM portal.sessions s
        JOIN portal.users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.ativo = true`,
        [tokenHash],
      );
      if (!rows.length) throw new ApiError(401, "UNAUTHORIZED", "Sessão inválida ou expirada.");
      return { ...rows[0], ...publicUser(rows[0]), tokenHash };
    },
    logout: (user) =>
      db.query("DELETE FROM portal.sessions WHERE token_hash = $1", [user.tokenHash]),
  };
}
