CREATE OR REPLACE FUNCTION public.portal_obter_configuracoes(p_token text)
RETURNS TABLE (nome text, cnpj text, endereco text, telefone text, email_notificacoes text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.portal_usuario_da_sessao(p_token);
  RETURN QUERY SELECT s.nome, s.cnpj, s.endereco, s.telefone, s.email_notificacoes
    FROM public.institution_settings s WHERE s.id = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_salvar_configuracoes(
  p_token text, p_nome text, p_cnpj text, p_endereco text, p_telefone text, p_email_notificacoes text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil user_profile;
BEGIN
  SELECT s.perfil INTO v_perfil FROM public.portal_usuario_da_sessao(p_token) s;
  IF v_perfil <> 'administrador' THEN
    RAISE EXCEPTION 'Somente administradores podem alterar as configurações.' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(p_nome, '')) > 200 OR length(coalesce(p_cnpj, '')) > 30
     OR length(coalesce(p_endereco, '')) > 500 OR length(coalesce(p_telefone, '')) > 50
     OR length(coalesce(p_email_notificacoes, '')) > 255 THEN
    RAISE EXCEPTION 'Algum campo excede o tamanho permitido.';
  END IF;
  INSERT INTO public.institution_settings (id, nome, cnpj, endereco, telefone, email_notificacoes, updated_at)
  VALUES (1, p_nome, p_cnpj, p_endereco, p_telefone, p_email_notificacoes, now())
  ON CONFLICT (id) DO UPDATE SET
    nome = EXCLUDED.nome, cnpj = EXCLUDED.cnpj, endereco = EXCLUDED.endereco,
    telefone = EXCLUDED.telefone, email_notificacoes = EXCLUDED.email_notificacoes,
    updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.portal_obter_configuracoes(text) FROM public;
GRANT EXECUTE ON FUNCTION public.portal_obter_configuracoes(text) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.portal_salvar_configuracoes(text, text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.portal_salvar_configuracoes(text, text, text, text, text, text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "prototipo_acesso_total" ON public.institution_settings;
REVOKE ALL ON public.institution_settings FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';