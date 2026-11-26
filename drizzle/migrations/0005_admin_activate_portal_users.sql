CREATE OR REPLACE FUNCTION public.portal_ativar_usuario(p_token text, p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil user_profile;
BEGIN
  SELECT s.perfil INTO v_perfil FROM public.portal_usuario_da_sessao(p_token) s;
  IF v_perfil <> 'administrador' THEN
    RAISE EXCEPTION 'Somente administradores podem ativar usuários.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.portal_users SET ativo = true WHERE id = p_id AND ativo = false;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.portal_users WHERE id = p_id) THEN
      RAISE EXCEPTION 'Este usuário já está ativo.' USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.portal_ativar_usuario(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.portal_ativar_usuario(text, uuid) TO anon, authenticated, service_role;
