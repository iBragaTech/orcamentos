import { z } from "zod";
import { ApiError } from "../errors.mjs";

export const linkFields = {
  nmUsuario: z.string().trim().min(1).max(15),
  cdPerfil: z.number().int().positive().max(2147483647),
  cdEstabelecimento: z.number().int().positive().max(2147483647),
  consultarTodosPacientes: z.boolean().default(false),
  cadastrarPacientes: z.boolean().default(false),
};

export function principalForLink(link) {
  return {
    enabled: true,
    tasyUsername: link.nmUsuario,
    tasyProfile: link.cdPerfil,
    tasyEstablishment: link.cdEstabelecimento,
    operations: [
      "usuarios.consultar",
      "pessoas-fisicas.consultar",
      "pessoas-fisicas.consultar-alergias",
      "pessoas-fisicas.consultar-cids",
      "pessoas-fisicas.buscar-cpf",
      "catalogos.convenios",
      "catalogos.categorias",
      "catalogos.procedimentos",
      "catalogos.opme",
      "catalogos.materiais",
      "precos.procedimento",
      "precos.material",
      ...(link.cadastrarPacientes ? ["pessoas-fisicas.salvar"] : []),
    ],
    allPessoaFisica: link.consultarTodosPacientes,
    pessoaFisicaIds: [],
    canCreatePessoaFisica: link.cadastrarPacientes,
    canUpdatePessoaFisica: false,
  };
}

export async function storeLink(tx, userId, principal, actorId) {
  const old =
    (
      await tx.query("SELECT principal FROM portal.tasy_user_links WHERE user_id=$1 FOR UPDATE", [
        userId,
      ])
    ).rows[0]?.principal ?? null;
  await tx.query(
    `INSERT INTO portal.tasy_user_links(user_id,nm_usuario,principal) VALUES($1,$2,$3::jsonb)
    ON CONFLICT(user_id) DO UPDATE SET nm_usuario=excluded.nm_usuario,principal=excluded.principal,updated_at=now()`,
    [userId, principal.tasyUsername, JSON.stringify(principal)],
  );
  await tx.query(
    "INSERT INTO portal.tasy_user_link_events(user_id,actor_id,anterior,novo) VALUES($1,$2,$3::jsonb,$4::jsonb)",
    [userId, actorId, old ? JSON.stringify(old) : null, JSON.stringify(principal)],
  );
}

export async function importLegacyLinks(db, principals) {
  await db.transaction(async (tx) => {
    for (const [id, principal] of Object.entries(principals)) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
      if (!(await tx.query("SELECT id FROM portal.users WHERE id=$1", [id])).rows.length) continue;
      if (
        (await tx.query("SELECT user_id FROM portal.tasy_user_links WHERE user_id=$1", [id])).rows
          .length
      )
        continue;
      await storeLink(tx, id, principal, null);
    }
  });
}

export function createLinkResolver(db, validate) {
  return async (user, queryDb = db) => {
    const row = (
      await queryDb.query("SELECT principal FROM portal.tasy_user_links WHERE user_id=$1", [
        user.id,
      ])
    ).rows[0];
    if (!row?.principal?.enabled)
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Usuário sem vínculo Tasy ativo. Solicite ao administrador a configuração do acesso.",
      );
    const p = row.principal;
    if (validate)
      await validate({
        nmUsuario: p.tasyUsername,
        cdPerfil: p.tasyProfile,
        cdEstabelecimento: p.tasyEstablishment,
      });
    const operations = [...p.operations];
    if (
      operations.includes("pessoas-fisicas.consultar") &&
      !operations.includes("pessoas-fisicas.consultar-alergias")
    )
      operations.push("pessoas-fisicas.consultar-alergias");
    if (
      operations.includes("pessoas-fisicas.consultar") &&
      !operations.includes("pessoas-fisicas.consultar-cids")
    )
      operations.push("pessoas-fisicas.consultar-cids");
    if (
      operations.includes("catalogos.procedimentos") &&
      !operations.includes("catalogos.procedimentos-internos")
    )
      operations.push("catalogos.procedimentos-internos");
    if (
      ["Médico", "Administrador"].includes(user.perfil) &&
      operations.includes("pessoas-fisicas.consultar") &&
      !operations.includes("pessoas-fisicas.atualizar-email")
    )
      operations.push("pessoas-fisicas.atualizar-email");
    if (
      ["Médico", "Administrador"].includes(user.perfil) &&
      !operations.includes("medicos.tempo-procedimento")
    )
      operations.push("medicos.tempo-procedimento");
    if (
      ["Médico", "Comercial", "Custos", "Administrador"].includes(user.perfil) &&
      operations.includes("pessoas-fisicas.consultar") &&
      !operations.includes("orcamentos.enviar")
    )
      operations.push("orcamentos.enviar");
    if (
      ["Médico", "Administrador", "Comercial", "Custos"].includes(user.perfil) &&
      operations.includes("pessoas-fisicas.consultar") &&
      !operations.includes("pessoas-fisicas.atualizar-telefone")
    )
      operations.push("pessoas-fisicas.atualizar-telefone");
    const gerais = user.perfil === "Gerais";
    return {
      ...p,
      // Gerais precisa localizar pacientes e consultar alergias/CIDs para abrir
      // solicitações cirúrgicas. Esse perfil recebe somente leitura de pessoas.
      operations: gerais
        ? operations.filter(
            (name) =>
              !name.startsWith("precos.") &&
              name !== "orcamentos.enviar" &&
              name !== "pessoas-fisicas.salvar" &&
              !name.startsWith("pessoas-fisicas.atualizar-"),
          )
        : operations,
      allPessoaFisica: gerais || p.allPessoaFisica === true,
      canCreatePessoaFisica: gerais ? false : p.canCreatePessoaFisica,
      canUpdatePessoaFisica: gerais ? false : p.canUpdatePessoaFisica,
      subject: user.id,
      ...(user.perfil === "Médico" ? { canUpdatePessoaFisica: false } : {}),
    };
  };
}

// Reads only identity and membership. Never reads passwords or hashes from Tasy.
export function createTasyLinkValidator(pool) {
  return async (link) => {
    if (!pool)
      throw new ApiError(
        503,
        "TASY_DISABLED",
        "Conecte a API ao Tasy para validar o usuário e o perfil.",
      );
    let c;
    try {
      c = await pool.getConnection();
      c.callTimeout = 10000;
      await c.execute("SET TRANSACTION READ ONLY");
      const result = await c.execute(
        `SELECT u.nm_usuario AS "nmUsuario" FROM TASY.usuario u
        JOIN TASY.usuario_perfil up ON up.nm_usuario=u.nm_usuario
        JOIN TASY.perfil p ON p.cd_perfil=up.cd_perfil
        WHERE LOWER(u.nm_usuario)=LOWER(:usuario) AND u.ie_situacao='A' AND p.ie_situacao='A'
        AND up.cd_perfil=:perfil AND (up.dt_validade IS NULL OR up.dt_validade>=SYSDATE)
        AND (up.dt_liberacao IS NULL OR up.dt_liberacao<=SYSDATE)
        AND (p.cd_estabelecimento IS NULL OR p.cd_estabelecimento=:estab)
        AND (u.cd_estabelecimento=:estab OR EXISTS(SELECT 1 FROM TASY.usuario_estabelecimento e
          WHERE e.nm_usuario_param=u.nm_usuario AND e.cd_estabelecimento=:estab))`,
        { usuario: link.nmUsuario, perfil: link.cdPerfil, estab: link.cdEstabelecimento },
        { maxRows: 2 },
      );
      if (result.rows?.length !== 1)
        throw new ApiError(
          403,
          "INVALID_TASY_LINK",
          "Usuário inativo, perfil não autorizado/vencido ou estabelecimento sem acesso no Tasy.",
        );
      return { ...link, nmUsuario: result.rows[0].nmUsuario };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(503, "TASY_UNAVAILABLE", "Não foi possível validar o vínculo no Tasy.");
    } finally {
      if (c) {
        await c.rollback().catch(() => {});
        await c.close({ drop: true }).catch(() => {});
      }
    }
  };
}

export function tasyUsernameForDirectoryLogin(value) {
  const login = String(value ?? "").trim().split("\\").at(-1).split("@")[0];
  if (!login || login.length > 15)
    throw new ApiError(400, "INVALID_AD_LOGIN", "O usuário de rede não corresponde a um NM_USUARIO Tasy válido.");
  return login;
}

export function createTasyUserOptions(pool) {
  return async (nmUsuario) => {
    if (!pool)
      throw new ApiError(503, "TASY_DISABLED", "Conecte a API ao Tasy para consultar os perfis do usuário.");
    let connection;
    try {
      connection = await pool.getConnection();
      connection.callTimeout = 10000;
      await connection.execute("SET TRANSACTION READ ONLY");
      const profileResult = await connection.execute(
          `SELECT DISTINCT c.cd_perfil AS "cdPerfil", c.ds_perfil AS "dsPerfil"
          FROM TASY.usuario a
          JOIN TASY.usuario_perfil b ON b.nm_usuario = a.nm_usuario
          JOIN TASY.perfil c ON c.cd_perfil = b.cd_perfil
          WHERE LOWER(a.nm_usuario) = LOWER(:usuario) AND a.ie_situacao = 'A'
          AND c.ie_situacao = 'A'
          AND (b.dt_validade IS NULL OR b.dt_validade >= SYSDATE)
          AND (b.dt_liberacao IS NULL OR b.dt_liberacao <= SYSDATE)
          ORDER BY c.ds_perfil`,
          { usuario: nmUsuario },
        );
      const establishmentResult = await connection.execute(
          `SELECT e.cd_estabelecimento AS "cdEstabelecimento",
          TASY.obter_nome_estab(e.cd_estabelecimento) AS "dsEstabelecimento"
          FROM (
            SELECT b.cd_estabelecimento
            FROM TASY.usuario a
            JOIN TASY.usuario_estabelecimento b ON b.nm_usuario_param = a.nm_usuario
            WHERE LOWER(a.nm_usuario) = LOWER(:usuario)
            UNION
            SELECT a.cd_estabelecimento
            FROM TASY.usuario a
            WHERE LOWER(a.nm_usuario) = LOWER(:usuario) AND a.cd_estabelecimento IS NOT NULL
          ) e
          ORDER BY "dsEstabelecimento"`,
          { usuario: nmUsuario },
        );
      return {
        nmUsuario,
        profiles: profileResult.rows ?? [],
        establishments: establishmentResult.rows ?? [],
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "TASY_UNAVAILABLE", "Não foi possível consultar os perfis e estabelecimentos Tasy.");
    } finally {
      if (connection) {
        await connection.rollback().catch(() => {});
        await connection.close({ drop: true }).catch(() => {});
      }
    }
  };
}
