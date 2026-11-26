CREATE OR REPLACE FUNCTION public.portal_excluir_usuario(p_token text, p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_perfil user_profile;
  v_target public.portal_users%ROWTYPE;
  v_admin_count integer;
BEGIN
  SELECT s.id, s.perfil INTO v_user_id, v_perfil
    FROM public.portal_usuario_da_sessao(p_token) s;
  IF v_perfil <> 'administrador' THEN
    RAISE EXCEPTION 'Somente administradores podem excluir usuários.' USING ERRCODE = '42501';
  END IF;
  IF p_id = v_user_id THEN
    RAISE EXCEPTION 'Não é possível excluir o próprio usuário.' USING ERRCODE = '23514';
  END IF;

  LOCK TABLE public.portal_users IN EXCLUSIVE MODE;
  SELECT * INTO v_target FROM public.portal_users WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_target.ativo THEN
    RAISE EXCEPTION 'Este usuário já está inativo.' USING ERRCODE = '23514';
  END IF;
  IF v_target.perfil = 'administrador' THEN
    SELECT count(*) INTO v_admin_count FROM public.portal_users
      WHERE perfil = 'administrador' AND ativo;
    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'Não é possível excluir o último administrador ativo.' USING ERRCODE = '23514';
    END IF;
  END IF;
  UPDATE public.portal_users SET ativo = false WHERE id = p_id;
  DELETE FROM public.portal_sessions WHERE user_id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.portal_excluir_usuario(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.portal_excluir_usuario(text, uuid) TO anon, authenticated, service_role;
