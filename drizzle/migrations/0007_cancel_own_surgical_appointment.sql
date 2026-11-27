CREATE OR REPLACE FUNCTION public.portal_cancelar_solicitacao_cirurgica(
  p_token text,
  p_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_status text;
BEGIN
  SELECT s.id INTO v_user_id FROM public.portal_usuario_da_sessao(p_token) s;
  SELECT a.status INTO v_status
    FROM public.surgical_appointments a
   WHERE a.id = p_id AND a.doctor_user_id = v_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação não encontrada ou você não tem permissão para cancelá-la.'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'cancelado' THEN
    RAISE EXCEPTION 'Esta solicitação já está cancelada.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.surgical_appointments SET status = 'cancelado' WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.portal_cancelar_solicitacao_cirurgica(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.portal_cancelar_solicitacao_cirurgica(text, uuid) TO anon, authenticated, service_role;
