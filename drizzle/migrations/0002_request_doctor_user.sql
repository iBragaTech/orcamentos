ALTER TABLE public.consultation_requests
  ADD COLUMN IF NOT EXISTS doctor_user_id uuid REFERENCES public.portal_users(id);
CREATE INDEX IF NOT EXISTS consultation_requests_doctor_user_idx
  ON public.consultation_requests(doctor_user_id);

CREATE OR REPLACE FUNCTION public.portal_orcamento_json(r public.consultation_requests)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(r) - 'patient_id' - 'doctor_id' - 'doctor_user_id'
    || jsonb_build_object(
      'patients', (SELECT jsonb_build_object('nome', p.nome, 'cpf', p.cpf, 'telefone', p.telefone,
                                             'email', p.email, 'nascimento', p.nascimento)
                     FROM public.patients p WHERE p.id = r.patient_id),
      'doctors', coalesce(
        (SELECT jsonb_build_object('nome', u.nome, 'crm', null)
           FROM public.portal_users u WHERE u.id = r.doctor_user_id),
        (SELECT jsonb_build_object('nome', d.nome, 'crm', d.crm)
           FROM public.doctors d WHERE d.id = r.doctor_id))
    );
$$;
REVOKE EXECUTE ON FUNCTION public.portal_orcamento_json(public.consultation_requests) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_criar_orcamento(p_token text, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_patient uuid;
  v_id uuid;
  v_medico jsonb := p_dados -> 'medico';
  v_por_medico boolean;
  v_uid uuid;
  v_perfil user_profile;
  v_doctor uuid;
BEGIN
  SELECT s.id, s.perfil INTO v_uid, v_perfil FROM public.portal_usuario_da_sessao(p_token) s;
  IF length(trim(coalesce(p_dados->>'nome', ''))) < 3 OR length(trim(coalesce(p_dados->>'nome', ''))) > 200 THEN
    RAISE EXCEPTION 'Informe o nome do paciente.';
  END IF;
  IF length(trim(coalesce(p_dados->>'cpf', ''))) NOT BETWEEN 11 AND 20 THEN
    RAISE EXCEPTION 'CPF inválido.';
  END IF;
  IF length(coalesce(p_dados->>'observacoes', '')) > 20000 THEN
    RAISE EXCEPTION 'Observações muito longas.';
  END IF;

  IF v_perfil = 'medico' THEN
    v_doctor := v_uid;
  ELSE
    IF nullif(p_dados->>'medicoUserId', '') IS NULL THEN
      RAISE EXCEPTION 'Selecione o médico solicitante.';
    END IF;
    SELECT u.id INTO v_doctor FROM public.portal_users u
     WHERE u.id = (p_dados->>'medicoUserId')::uuid AND u.perfil = 'medico' AND u.ativo;
    IF v_doctor IS NULL THEN
      RAISE EXCEPTION 'Médico solicitante inválido ou inativo.';
    END IF;
  END IF;

  v_por_medico := p_dados->>'origem' = 'medico' AND v_medico IS NOT NULL AND jsonb_typeof(v_medico) = 'object';

  INSERT INTO public.patients (nome, cpf, telefone, nascimento)
  VALUES (trim(p_dados->>'nome'), trim(p_dados->>'cpf'),
          nullif(p_dados->>'telefone', ''), nullif(p_dados->>'nascimento', '')::date)
  ON CONFLICT (cpf) DO UPDATE
    SET nome = EXCLUDED.nome, telefone = EXCLUDED.telefone, nascimento = EXCLUDED.nascimento
  RETURNING id INTO v_patient;

  INSERT INTO public.consultation_requests (
    numero, patient_id, doctor_user_id, especialidade, tipo_consulta, data_desejada, observacoes, status,
    honorarios_medicos, diaria, cti, opme, anatomo_patologico, reserva_sangue,
    equipe_multidisciplinar, fisioterapia, tempo_bloco, obs_medico, preenchido_medico_em)
  VALUES (
    'SOL-' || extract(year FROM now())::int || '-' || (floor(random() * 9000) + 1000)::int,
    v_patient,
    v_doctor,
    nullif(p_dados->>'especialidade', ''),
    nullif(p_dados->>'tipoConsulta', ''),
    nullif(p_dados->>'dataDesejada', '')::date,
    nullif(p_dados->>'observacoes', ''),
    CASE WHEN v_por_medico THEN 'aguardando_comercial'::request_status ELSE 'aguardando_medico'::request_status END,
    CASE WHEN v_por_medico THEN (v_medico->>'honorariosMedicos')::numeric END,
    CASE WHEN v_por_medico THEN (v_medico->>'diaria')::numeric END,
    CASE WHEN v_por_medico THEN (v_medico->>'cti')::numeric END,
    CASE WHEN v_por_medico THEN v_medico->>'opme' END,
    CASE WHEN v_por_medico THEN v_medico->>'anatomoPatologico' END,
    CASE WHEN v_por_medico THEN v_medico->>'reservaSangue' END,
    CASE WHEN v_por_medico THEN v_medico->>'equipeMultidisciplinar' END,
    CASE WHEN v_por_medico THEN (v_medico->>'fisioterapia')::integer END,
    CASE WHEN v_por_medico THEN v_medico->>'tempoBloco' END,
    CASE WHEN v_por_medico THEN v_medico->>'obsMedico' END,
    CASE WHEN v_por_medico THEN now() END)
  RETURNING id INTO v_id;

  IF v_por_medico THEN
    INSERT INTO public.request_events (request_id, titulo, descricao, ordem) VALUES
      (v_id, 'Solicitação criada', 'Registrada pelo médico responsável', 1),
      (v_id, 'Honorários preenchidos', 'Valores informados na criação pelo médico', 3),
      (v_id, 'Enviada ao Comercial', 'Aguardando valores hospitalares', 4);
  ELSE
    INSERT INTO public.request_events (request_id, titulo, descricao, ordem) VALUES
      (v_id, 'Solicitação criada', 'Registrada no portal', 1),
      (v_id, 'Solicitação enviada ao médico', 'Encaminhada para preenchimento de honorários', 2);
  END IF;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.portal_criar_orcamento(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.portal_criar_orcamento(text, jsonb) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';