-- Sessões do portal: o login passa a emitir um token aleatório; o banco só
-- guarda o hash. Todas as operações de dados validam esse token no servidor.
CREATE TABLE public.portal_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.portal_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
GRANT ALL ON public.portal_sessions TO service_role;
ALTER TABLE public.portal_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX portal_sessions_user_idx ON public.portal_sessions(user_id);

-- Resolve o usuário ativo dono do token (uso interno das funções abaixo).
CREATE OR REPLACE FUNCTION public.portal_usuario_da_sessao(p_token text)
RETURNS TABLE (id uuid, perfil user_profile)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.perfil
    FROM public.portal_sessions s
    JOIN public.portal_users u ON u.id = s.user_id
   WHERE s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
     AND s.expires_at > now()
     AND u.ativo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão expirada. Entre novamente.' USING ERRCODE = '28000';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.portal_usuario_da_sessao(text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.iniciar_sessao(p_email text, p_senha text)
RETURNS TABLE (id uuid, nome text, email text, perfil user_profile, telefone text, token text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.portal_users%ROWTYPE;
  v_token text;
BEGIN
  SELECT * INTO v_user FROM public.portal_users u
   WHERE lower(u.email) = lower(trim(p_email))
     AND u.ativo
     AND u.senha_hash IS NOT NULL
     AND u.senha_hash = crypt(p_senha, u.senha_hash);
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE public.portal_users u SET ultimo_acesso = now() WHERE u.id = v_user.id;
  DELETE FROM public.portal_sessions s WHERE s.expires_at <= now();
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.portal_sessions (token_hash, user_id, expires_at)
  VALUES (encode(digest(v_token, 'sha256'), 'hex'), v_user.id, now() + interval '12 hours');
  RETURN QUERY SELECT v_user.id, v_user.nome, v_user.email, v_user.perfil, v_user.telefone, v_token;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.iniciar_sessao(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.iniciar_sessao(text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.encerrar_sessao(p_token text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, extensions
AS $$
  DELETE FROM public.portal_sessions
   WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;
REVOKE EXECUTE ON FUNCTION public.encerrar_sessao(text) FROM public;
GRANT EXECUTE ON FUNCTION public.encerrar_sessao(text) TO anon, authenticated, service_role;

-- Representação JSON de um orçamento (mesmo formato usado pela tela).
CREATE OR REPLACE FUNCTION public.portal_orcamento_json(r public.consultation_requests)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(r) - 'patient_id' - 'doctor_id'
    || jsonb_build_object(
      'patients', (SELECT jsonb_build_object('nome', p.nome, 'cpf', p.cpf, 'telefone', p.telefone,
                                             'email', p.email, 'nascimento', p.nascimento)
                     FROM public.patients p WHERE p.id = r.patient_id),
      'doctors', (SELECT jsonb_build_object('nome', d.nome, 'crm', d.crm)
                    FROM public.doctors d WHERE d.id = r.doctor_id)
    );
$$;
REVOKE EXECUTE ON FUNCTION public.portal_orcamento_json(public.consultation_requests) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_listar_orcamentos(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.portal_usuario_da_sessao(p_token);
  RETURN coalesce((SELECT jsonb_agg(public.portal_orcamento_json(r) ORDER BY r.created_at DESC)
                     FROM public.consultation_requests r), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_obter_orcamento(p_token text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.portal_usuario_da_sessao(p_token);
  RETURN (SELECT public.portal_orcamento_json(r) FROM public.consultation_requests r WHERE r.id = p_id);
END;
$$;

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
BEGIN
  PERFORM 1 FROM public.portal_usuario_da_sessao(p_token);
  IF length(trim(coalesce(p_dados->>'nome', ''))) < 3 OR length(trim(coalesce(p_dados->>'nome', ''))) > 200 THEN
    RAISE EXCEPTION 'Informe o nome do paciente.';
  END IF;
  IF length(trim(coalesce(p_dados->>'cpf', ''))) NOT BETWEEN 11 AND 20 THEN
    RAISE EXCEPTION 'CPF inválido.';
  END IF;
  IF length(coalesce(p_dados->>'observacoes', '')) > 20000 THEN
    RAISE EXCEPTION 'Observações muito longas.';
  END IF;
  v_por_medico := p_dados->>'origem' = 'medico' AND v_medico IS NOT NULL AND jsonb_typeof(v_medico) = 'object';

  INSERT INTO public.patients (nome, cpf, telefone, nascimento)
  VALUES (trim(p_dados->>'nome'), trim(p_dados->>'cpf'),
          nullif(p_dados->>'telefone', ''), nullif(p_dados->>'nascimento', '')::date)
  ON CONFLICT (cpf) DO UPDATE
    SET nome = EXCLUDED.nome, telefone = EXCLUDED.telefone, nascimento = EXCLUDED.nascimento
  RETURNING id INTO v_patient;

  INSERT INTO public.consultation_requests (
    numero, patient_id, especialidade, tipo_consulta, data_desejada, observacoes, status,
    honorarios_medicos, diaria, cti, opme, anatomo_patologico, reserva_sangue,
    equipe_multidisciplinar, fisioterapia, tempo_bloco, obs_medico, preenchido_medico_em)
  VALUES (
    'SOL-' || extract(year FROM now())::int || '-' || (floor(random() * 9000) + 1000)::int,
    v_patient,
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

CREATE OR REPLACE FUNCTION public.portal_salvar_honorarios(p_token text, p_id uuid, p_dados jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil user_profile;
BEGIN
  SELECT perfil INTO v_perfil FROM public.portal_usuario_da_sessao(p_token);
  IF v_perfil NOT IN ('administrador', 'medico') THEN
    RAISE EXCEPTION 'Seu perfil não pode preencher honorários.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.consultation_requests SET
    honorarios_medicos = (p_dados->>'honorariosMedicos')::numeric,
    diaria = (p_dados->>'diaria')::numeric,
    cti = (p_dados->>'cti')::numeric,
    opme = p_dados->>'opme',
    anatomo_patologico = p_dados->>'anatomoPatologico',
    reserva_sangue = p_dados->>'reservaSangue',
    equipe_multidisciplinar = p_dados->>'equipeMultidisciplinar',
    fisioterapia = (p_dados->>'fisioterapia')::integer,
    tempo_bloco = p_dados->>'tempoBloco',
    obs_medico = p_dados->>'obsMedico',
    preenchido_medico_em = now(),
    status = 'aguardando_comercial'
  WHERE id = p_id AND status <> 'inativo';
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado ou inativo.'; END IF;
  INSERT INTO public.request_events (request_id, titulo, descricao, ordem)
  VALUES (p_id, 'Honorários preenchidos', 'Valores informados pelo médico responsável', 3);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_inativar_orcamento(p_token text, p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.portal_usuario_da_sessao(p_token);
  IF length(trim(coalesce(p_motivo, ''))) = 0 OR length(p_motivo) > 2000 THEN
    RAISE EXCEPTION 'Informe o motivo da inativação.';
  END IF;
  UPDATE public.consultation_requests SET status = 'inativo' WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado.'; END IF;
  INSERT INTO public.request_events (request_id, titulo, descricao, ordem)
  VALUES (p_id, 'Orçamento inativado', trim(p_motivo), 9);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_salvar_valor_hospitalar(p_token text, p_id uuid, p_valor numeric, p_obs text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil user_profile;
BEGIN
  SELECT perfil INTO v_perfil FROM public.portal_usuario_da_sessao(p_token);
  IF v_perfil NOT IN ('administrador', 'comercial') THEN
    RAISE EXCEPTION 'Seu perfil não pode preencher valores hospitalares.' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(p_obs, '')) > 5000 THEN RAISE EXCEPTION 'Observação muito longa.'; END IF;
  UPDATE public.consultation_requests SET
    valor_hospitalar = p_valor,
    obs_comercial = p_obs,
    preenchido_comercial_em = now(),
    status = 'concluido'
  WHERE id = p_id AND status <> 'inativo';
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado ou inativo.'; END IF;
  INSERT INTO public.request_events (request_id, titulo, descricao, ordem)
  VALUES (p_id, 'Valor hospitalar preenchido', 'Orçamento concluído pelo setor Comercial', 5);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_linha_do_tempo(p_token text, p_id uuid)
RETURNS TABLE (titulo text, descricao text, concluido boolean, criado_em timestamptz, ordem integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.portal_usuario_da_sessao(p_token);
  RETURN QUERY SELECT e.titulo, e.descricao, e.concluido, e.criado_em, e.ordem
    FROM public.request_events e WHERE e.request_id = p_id ORDER BY e.ordem;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_listar_medicos(p_token text)
RETURNS TABLE (id uuid, nome text, ativo boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.portal_usuario_da_sessao(p_token);
  RETURN QUERY SELECT u.id, u.nome, u.ativo FROM public.portal_users u
    WHERE u.perfil = 'medico' AND u.ativo ORDER BY u.nome;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_listar_usuarios(p_token text)
RETURNS TABLE (id uuid, nome text, email text, perfil user_profile, ativo boolean, ultimo_acesso timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil user_profile;
BEGIN
  SELECT s.perfil INTO v_perfil FROM public.portal_usuario_da_sessao(p_token) s;
  IF v_perfil <> 'administrador' THEN
    RAISE EXCEPTION 'Somente administradores podem listar usuários.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT u.id, u.nome, u.email, u.perfil, u.ativo, u.ultimo_acesso
    FROM public.portal_users u ORDER BY u.nome;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.portal_listar_orcamentos(text)',
    'public.portal_obter_orcamento(text, uuid)',
    'public.portal_criar_orcamento(text, jsonb)',
    'public.portal_salvar_honorarios(text, uuid, jsonb)',
    'public.portal_inativar_orcamento(text, uuid, text)',
    'public.portal_salvar_valor_hospitalar(text, uuid, numeric, text)',
    'public.portal_linha_do_tempo(text, uuid)',
    'public.portal_listar_medicos(text)',
    'public.portal_listar_usuarios(text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM public', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', f);
  END LOOP;
END $$;

-- Fecha o acesso direto às tabelas: só as funções acima (que validam a sessão) chegam aos dados.
DROP POLICY IF EXISTS "prototipo_acesso_total" ON public.consultation_requests;
DROP POLICY IF EXISTS "prototipo_acesso_total" ON public.request_events;
DROP POLICY IF EXISTS "prototipo_acesso_total" ON public.doctors;
DROP POLICY IF EXISTS "prototipo_acesso_total" ON public.patients;
DROP POLICY IF EXISTS "prototipo_acesso_total" ON public.portal_users;
REVOKE ALL ON public.consultation_requests, public.request_events, public.doctors,
  public.patients, public.portal_users FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';