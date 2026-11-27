import type { ConsultationRequest, Doctor, PortalUser, TimelineEvent } from "@/data/mock";
import type { DoctorFeesInput, InstitutionSettings, NewRequestInput, TasyUserOptions } from "./repository";
import { localAuth, portalCall } from "./local-api";
import type {
  NewSurgicalAppointmentInput,
  SurgicalAppointment,
} from "@/data/surgical-appointments";

export const localRepository = {
  getMyTasyOptions: () => portalCall<TasyUserOptions>("getMyTasyOptions"),
  saveMyTasyLink: (input: { cdPerfil: number; cdEstabelecimento: number }) =>
    portalCall<{ needsTasyLink: boolean; needsPortalApproval: boolean; tasyLinked: boolean }>("saveMyTasyLink", input),
  async listRequests(): Promise<ConsultationRequest[]> {
    const all: ConsultationRequest[] = [];
    for (let offset = 0; ; offset += 200) {
      const page = await portalCall<ConsultationRequest[]>("listRequests", { offset, limit: 200 });
      all.push(...page);
      if (page.length < 200) return all;
    }
  },
  getRequest: (id: string) => portalCall<ConsultationRequest | null>("getRequest", { id }),
  createRequest: (input: NewRequestInput) => portalCall<string>("createRequest", input),
  saveDoctorFees: (id: string, input: DoctorFeesInput) =>
    portalCall<void>("saveDoctorFees", { id, input }),
  saveHospitalValue: (id: string, valor: number | null, obs: string) =>
    portalCall<void>("saveHospitalValue", { id, valor, obs }),
  deactivateRequest: (id: string, motivo: string) =>
    portalCall<void>("deactivateRequest", { id, motivo }),
  getTimeline: (id: string) => portalCall<TimelineEvent[]>("getTimeline", { id }),
  listDoctors: () => portalCall<Doctor[]>("listDoctors"),

  listUsers: async () => {
    const users = await portalCall<PortalUser[]>("listUsers");
    return users.map((user) => ({ ...user, email: user.email ?? "" }));
  },
  createUser: (input: {
    nome: string;
    email: string;
    perfil: PortalUser["perfil"];
    authSource?: "portal" | "ad";
    adLogin?: string;
    senha?: string;
    nmUsuario?: string;
    cdPerfil?: number;
    cdEstabelecimento?: number;
    consultarTodosPacientes?: boolean;
    cadastrarPacientes?: boolean;
  }) => portalCall<void>("createUser", input),
  updateUser: (input: {
    id: string;
    nome: string;
    email: string;
    perfil: PortalUser["perfil"];
    authSource?: "ad";
    adLogin?: string;
  }) => portalCall<void>("updateUser", input),
  deleteUser: (id: string) => portalCall<void>("deleteUser", { id }),
  activateUser: (id: string) => portalCall<void>("activateUser", { id }),
  updateMyProfile: (input: { id: string; nome: string; email: string; telefone: string }) =>
    portalCall<{ id: string; nome: string; email: string; telefone: string }>(
      "updateMyProfile",
      input,
    ),
  getSettings: () => portalCall<InstitutionSettings>("getSettings"),
  saveSettings: (input: InstitutionSettings) => portalCall<void>("saveSettings", input),
  listSurgicalAppointments: () => portalCall<SurgicalAppointment[]>("listSurgicalAppointments"),
  createSurgicalAppointment: (input: NewSurgicalAppointmentInput) =>
    portalCall<string>("createSurgicalAppointment", input),
  cancelSurgicalAppointment: (id: string) =>
    portalCall<void>("cancelSurgicalAppointment", { id }),
  signIn: localAuth.signIn,
};
