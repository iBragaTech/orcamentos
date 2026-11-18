<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Portal data tables (orçamentos, pacientes, médicos, eventos, usuários) have no direct client access; the browser calls `portal_*` SECURITY DEFINER RPCs with the session token from `iniciar_sessao`, which validate the token and role server-side. Why: the app uses its own login, not Supabase Auth, so RLS cannot identify the caller.
