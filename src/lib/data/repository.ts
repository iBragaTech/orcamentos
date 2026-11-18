// Camada única de acesso a dados do portal.
//
// Hoje: lê e grava no PostgreSQL gerenciado pelo Lovable Cloud, usando apenas
// SQL/tabelas padrão (sem recursos exclusivos do provedor).
//
// Amanhã (migração para o PostgreSQL do hospital): basta trocar as chamadas
// deste arquivo por uma API interna ou driver PostgreSQL. Nenhuma tela precisa
// mudar, pois todas consomem apenas as funções exportadas aqui.
// Ver docs/integracao-postgres.md.

import { supabase } from "@/integrations/supabase/client";
import { supabaseAuthEnabled, toPortalUser } from "@/lib/auth/supabase-auth";
import { localAuthEnabled } from "./local-api";
import { localRepository } from "./local-repository";
import type {
  ConsultationRequest,
  Doctor,
  PortalUser,
  RequestStatus,
  TimelineEvent,
} from "@/data/mock";
import type {
  NewSurgicalAppointmentInput,
  SurgicalAppointment,
} from "@/data/surgical-appointments";

export interface InstitutionSettings {
  nome: string;
  cnpj: string;
  endereco: string;
  telefone: string;
  emailNotificacoes: string;
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function fmtDateTime(value: string | null): string {
  if (!value) return "—";
  const dt = new Date(value);
  return dt.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function num(value: number | string | null): number | null {
  if (value === null || value === "") return null;
  return typeof value === "number" ? value : Number(value);
}

const REQUEST_SELECT = `
  id, numero, especialidade, tipo_consulta, data_desejada, status, observacoes,
  preenchido_comercial_em,
  honorarios_medicos, diaria, cti, opme, anatomo_patologico, reserva_sangue,
  equipe_multidisciplinar, fisioterapia, tempo_bloco, obs_medico,
  valor_hospitalar, obs_comercial, created_at,
  patients:patient_id ( nome, cpf, telefone, email, nascimento ),
  doctors:doctor_id ( nome, crm )
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRequest(row: any): ConsultationRequest {
  return {
    id: row.id,
    numero: row.numero,
    dataAprovacao: row.preenchido_comercial_em ?? null,
    solicitante: row.solicitante ?? row.created_by_nome ?? "—",
    paciente: {
      nome: row.patients?.nome ?? "—",
      cpf: row.patients?.cpf ?? "—",
      telefone: row.patients?.telefone ?? "—",
      email: row.patients?.email ?? "—",
      nascimento: fmtDate(row.patients?.nascimento ?? null),
    },
    medico: row.doctors?.nome ?? "—",
    crm: row.doctors?.crm ?? "—",
    especialidade: row.especialidade ?? "",
    tipoConsulta: row.tipo_consulta ?? "",
    dataDesejada: fmtDate(row.data_desejada),
    data: fmtDate(row.created_at),
    status: row.status as RequestStatus,
    honorariosMedicos: num(row.honorarios_medicos),
    diaria: num(row.diaria),
    cti: num(row.cti),
    opme: row.opme ?? "",
    anatomoPatologico: row.anatomo_patologico ?? "",
    reservaSangue: row.reserva_sangue ?? "",
    equipeMultidisciplinar: row.equipe_multidisciplinar ?? "",
    fisioterapia: row.fisioterapia ?? null,
    tempoBloco: row.tempo_bloco ?? "",
    obsMedico: row.obs_medico ?? "",
    valorHospitalar: num(row.valor_hospitalar),
    obsComercial: row.obs_comercial ?? "",
    observacoes: row.observacoes ?? "",
  };
}

export interface NewRequestInput {
  requestKey?: string;
  tasy?: {
    cdPessoaFisica: string;
    cdConvenio: string;
    convenioNome?: string;
    cdCategoria: string;
    categoriaNome?: string;
    procedimentos: { codigo: string; origem: string; quantidade?: number }[];
    materiais: { codigo: string; quantidade?: number }[];
  };
  nome: string;
  nascimento: string; // yyyy-mm-dd
  cpf: string;
  telefone: string;
  telefoneAnterior?: string;
  email?: string;
  especialidade?: string;
  tipoConsulta?: string;
  dataDesejada?: string; // yyyy-mm-dd
  observacoes?: string;
  // Quando o próprio médico cria o orçamento, ele já informa os dados médicos
  // e o orçamento segue direto para o setor Comercial.
  origem?: "comercial" | "medico";
  medico?: DoctorFeesInput;
}

export interface DoctorFeesInput {
  honorariosMedicos: number | null;
  diaria: number | null;
  cti: number | null;
  opme: string;
  anatomoPatologico: string;
  reservaSangue: string;
  equipeMultidisciplinar: string;
  fisioterapia: number | null;
  tempoBloco: string;
  obsMedico: string;
}

// Token de sessão emitido pelo login (iniciar_sessao). O banco valida o token
// em toda operação; sem ele nenhum dado de orçamento, paciente ou usuário é lido.
function sessionToken(): string {
  try {
    const raw = localStorage.getItem("portal.session");
    const token = raw ? (JSON.parse(raw) as { token?: string }).token : undefined;
    if (token) return token;
  } catch {
    /* sessão inválida */
  }
  throw new Error("Sessão expirada. Entre novamente.");
}

async function portalRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (supabase as any).rpc(fn, { p_token: sessionToken(), ...args });
  if (error) {
    if (error.code === "28000" || /Sessão expirada/i.test(error.message)) {
      try {
        localStorage.removeItem("portal.session");
      } catch {
        /* storage indisponível */
      }
      if (typeof window !== "undefined") window.location.assign("/login");
      throw new Error("Sessão expirada. Entre novamente.");
    }
    throw new Error(error.message);
  }
  return data as T;
}

const supabaseRepository = {
  async listSurgicalAppointments(): Promise<SurgicalAppointment[]> {
    const sessionRaw = localStorage.getItem("portal.session");
    if (!sessionRaw) return [];
    const session = JSON.parse(sessionRaw) as { id: string; perfil: string };
    const { data, error } = await (supabase as any).rpc("listar_agendamentos_cirurgicos", {
      p_user_id: session.id,
      p_perfil: session.perfil,
    });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => ({
      id: row.id,
      patientName: row.patient_name,
      patientCpf: row.patient_cpf,
      doctorUserId: row.doctor_user_id,
      doctorName: row.doctor_name,
      desiredDate: row.desired_date,
      status: row.status,
      createdAt: row.created_at,
      dados: (row.dados ?? null) as SurgicalAppointment["dados"],
    }));
  },

  async createSurgicalAppointment(input: NewSurgicalAppointmentInput): Promise<string> {
    const sessionRaw = localStorage.getItem("portal.session");
    if (!sessionRaw) throw new Error("Sessão não encontrada.");
    const session = JSON.parse(sessionRaw) as { id: string };
    const { data, error } = await (supabase as any).rpc("criar_agendamento_cirurgico", {
      p_user_id: session.id,
      p_patient_name: input.patientName,
      p_patient_cpf: input.patientCpf,
      p_desired_date: input.desiredDate,
      p_dados: input.dados ? JSON.parse(JSON.stringify(input.dados)) : null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  },

  async listRequests(): Promise<ConsultationRequest[]> {
    const data = await portalRpc<any[] | null>("portal_listar_orcamentos");
    return (data ?? []).map(mapRequest);
  },

  async getRequest(id: string): Promise<ConsultationRequest | null> {
    const data = await portalRpc<any | null>("portal_obter_orcamento", { p_id: id });
    return data ? mapRequest(data) : null;
  },

  async createRequest(input: NewRequestInput): Promise<string> {
    const porMedico = input.origem === "medico" && !!input.medico;
    return portalRpc<string>("portal_criar_orcamento", {
      p_dados: {
        nome: input.nome,
        cpf: input.cpf,
        telefone: input.telefone || null,
        nascimento: input.nascimento || null,
        especialidade: input.especialidade || null,
        tipoConsulta: input.tipoConsulta || null,
        dataDesejada: input.dataDesejada || null,
        observacoes: input.observacoes || null,
        origem: porMedico ? "medico" : "comercial",
        medico: porMedico ? input.medico : null,
      },
    });
  },

  async saveDoctorFees(requestId: string, input: DoctorFeesInput): Promise<void> {
    await portalRpc("portal_salvar_honorarios", { p_id: requestId, p_dados: input });
  },

  // Inativa o orçamento: sai da lista de ativos e fica bloqueado para alterações.
  // Não há exclusão — o registro é mantido no histórico.
  async deactivateRequest(requestId: string, motivo: string): Promise<void> {
    await portalRpc("portal_inativar_orcamento", { p_id: requestId, p_motivo: motivo });
  },

  async saveHospitalValue(requestId: string, valor: number | null, obs: string): Promise<void> {
    await portalRpc("portal_salvar_valor_hospitalar", {
      p_id: requestId,
      p_valor: valor,
      p_obs: obs,
    });
  },

  async listDoctors(): Promise<Doctor[]> {
    const data = await portalRpc<any[] | null>("portal_listar_medicos");
    return (data ?? []).map((d) => ({
      id: d.id,
      nome: d.nome,
      crm: "",
      especialidade: "",
      ativo: d.ativo,
      solicitacoes: 0,
    }));
  },

  async listUsers(): Promise<PortalUser[]> {
    const data = (await portalRpc<any[] | null>("portal_listar_usuarios")) ?? [];
    const labels: Record<string, PortalUser["perfil"]> = {
      administrador: "Administrador",
      comercial: "Comercial",
      medico: "Médico",
    };
    return (data as any[]).map((u) => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      perfil: labels[u.perfil] ?? "Comercial",
      ativo: u.ativo,
      ultimoAcesso: fmtDateTime(u.ultimo_acesso),
    }));
  },

  // Valida e-mail + senha no banco (função verificar_login, hash bcrypt/pgcrypto).
  async signIn(email: string, senha: string) {
    if (supabaseAuthEnabled) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
      if (error)
        throw new Error("Não foi possível entrar. Verifique suas credenciais e tente novamente.");
      const user = data.user ? toPortalUser(data.user) : null;
      if (!user) {
        await supabase.auth.signOut({ scope: "local" });
        throw new Error("Seu usuário ainda não possui um perfil de acesso ao portal.");
      }
      return user;
    }
    const { data, error } = await (supabase as any).rpc("iniciar_sessao", {
      p_email: email,
      p_senha: senha,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const labels: Record<string, PortalUser["perfil"]> = {
      administrador: "Administrador",
      comercial: "Comercial",
      medico: "Médico",
    };
    return {
      id: row.id as string,
      nome: row.nome as string,
      email: row.email as string,
      perfil: (labels[row.perfil] ?? "Comercial") as PortalUser["perfil"],
      telefone: (row.telefone as string | null) ?? "",
      token: row.token as string,
    };
  },

  // Atualiza nome, e-mail e telefone do próprio usuário logado.
  async updateMyProfile(input: {
    id: string;
    nome: string;
    email: string;
    telefone: string;
  }): Promise<{ id: string; nome: string; email: string; telefone: string }> {
    const { data, error } = await (supabase as any).rpc("atualizar_meu_perfil", {
      p_id: input.id,
      p_nome: input.nome,
      p_email: input.email,
      p_telefone: input.telefone,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Usuário não encontrado ou inativo.");
    return {
      id: row.id as string,
      nome: row.nome as string,
      email: row.email as string,
      telefone: (row.telefone as string | null) ?? "",
    };
  },

  // Cadastra usuário do portal com senha inicial (hash bcrypt no banco).
  async createUser(input: {
    nome: string;
    email: string;
    perfil: PortalUser["perfil"];
    senha: string;
    nmUsuario?: string;
    cdPerfil?: number;
    cdEstabelecimento?: number;
    consultarTodosPacientes?: boolean;
    cadastrarPacientes?: boolean;
  }): Promise<void> {
    if (supabaseAuthEnabled) {
      throw new Error(
        "Solicite ao administrador de identidade o cadastro de acesso deste usuário.",
      );
    }
    const perfilDb: Record<string, string> = {
      Administrador: "administrador",
      Comercial: "comercial",
      Médico: "medico",
    };
    const { error } = await (supabase as any).rpc("criar_usuario", {
      p_nome: input.nome,
      p_email: input.email,
      p_perfil: perfilDb[input.perfil] ?? "comercial",
      p_senha: input.senha,
    });
    if (error) throw new Error(error.message);
  },

  async getTimeline(requestId: string): Promise<TimelineEvent[]> {
    const data = (await portalRpc<any[] | null>("portal_linha_do_tempo", { p_id: requestId })) ?? [];
    const registrados = (data as any[]).map((e) => ({
      titulo: e.titulo,
      descricao: e.descricao ?? "",
      data: fmtDateTime(e.criado_em),
      concluido: e.concluido,
    }));
    const previstos: TimelineEvent[] = [
      {
        titulo: "Solicitação criada",
        descricao: "Registrada no portal",
        data: "—",
        concluido: false,
      },
      {
        titulo: "Solicitação enviada ao médico",
        descricao: "Encaminhada para preenchimento de honorários",
        data: "—",
        concluido: false,
      },
      {
        titulo: "Honorários preenchidos",
        descricao: "Aguardando ação do médico responsável",
        data: "—",
        concluido: false,
      },
      {
        titulo: "Enviada ao Comercial",
        descricao: "Etapa seguinte do fluxo",
        data: "—",
        concluido: false,
      },
      {
        titulo: "Valor hospitalar preenchido",
        descricao: "Preenchimento pelo setor Comercial",
        data: "—",
        concluido: false,
      },
      {
        titulo: "Orçamento concluído",
        descricao: "Orçamento final disponível ao paciente",
        data: "—",
        concluido: false,
      },
    ];
    return previstos.map((p) => registrados.find((r) => r.titulo === p.titulo) ?? p);
  },

  async getSettings(): Promise<InstitutionSettings> {
    const rows = (await portalRpc<any[] | null>("portal_obter_configuracoes")) ?? [];
    const data = rows[0];
    return {
      nome: data?.nome ?? "",
      cnpj: data?.cnpj ?? "",
      endereco: data?.endereco ?? "",
      telefone: data?.telefone ?? "",
      emailNotificacoes: data?.email_notificacoes ?? "",
    };
  },

  async saveSettings(input: InstitutionSettings): Promise<void> {
    await portalRpc("portal_salvar_configuracoes", {
      p_nome: input.nome,
      p_cnpj: input.cnpj,
      p_endereco: input.endereco,
      p_telefone: input.telefone,
      p_email_notificacoes: input.emailNotificacoes,
    });
  },
};

export const repository: typeof supabaseRepository = localAuthEnabled
  ? localRepository
  : supabaseRepository;
