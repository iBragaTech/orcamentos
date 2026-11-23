CREATE OR REPLACE FUNCTION public.portal_atualizar_usuario(
  p_token text, p_id uuid, p_nome text, p_email text, p_perfil user_profile
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil user_profile;
BEGIN
  SELECT s.perfil INTO v_perfil FROM public.portal_usuario_da_sessao(p_token) s;
  IF v_perfil <> 'administrador' THEN
    RAISE EXCEPTION 'Somente administradores podem editar usuários.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.portal_users
    SET nome = trim(p_nome), email = lower(trim(p_email)), perfil = p_perfil
    WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.portal_atualizar_usuario(text, uuid, text, text, user_profile) FROM public;
GRANT EXECUTE ON FUNCTION public.portal_atualizar_usuario(text, uuid, text, text, user_profile) TO anon, authenticated, service_role;
