import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMyTasyOptions, useSaveMyTasyLink } from "@/lib/data/hooks";

export function FirstTasyLink({ nome }: { nome: string }) {
  const options = useMyTasyOptions(true);
  const save = useSaveMyTasyLink();
  const [profile, setProfile] = useState("");
  const [establishment, setEstablishment] = useState("");

  async function submit() {
    if (!profile || !establishment) {
      toast.error("Selecione seu perfil e estabelecimento Tasy.");
      return;
    }
    try {
      await save.mutateAsync({ cdPerfil: Number(profile), cdEstabelecimento: Number(establishment) });
      toast.success("Acesso Tasy associado à sua conta.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível associar seu acesso Tasy.");
    }
  }

  const profiles = options.data?.profiles ?? [];
  const establishments = options.data?.establishments ?? [];
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Configure seu acesso Tasy</CardTitle>
          <CardDescription>
            Olá, {nome}. Para concluir seu primeiro acesso, escolha um perfil e um estabelecimento associados ao seu usuário de rede.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {options.isLoading && <p className="text-sm text-muted-foreground">Consultando seus acessos no Tasy...</p>}
          {options.error && (
            <p role="alert" className="text-sm text-destructive">
              {options.error instanceof Error ? options.error.message : "Não foi possível consultar seus acessos no Tasy."}
            </p>
          )}
          {options.data && profiles.length === 0 && (
            <p role="alert" className="text-sm text-destructive">Nenhum perfil ativo foi encontrado para o usuário Tasy {options.data.nmUsuario}.</p>
          )}
          {options.data && establishments.length === 0 && (
            <p role="alert" className="text-sm text-destructive">Nenhum estabelecimento foi encontrado para o seu usuário Tasy.</p>
          )}
          {profiles.length > 0 && (
            <div className="grid gap-2">
              <Label>Perfil Tasy</Label>
              <Select value={profile} onValueChange={setProfile}>
                <SelectTrigger><SelectValue placeholder="Selecione o perfil" /></SelectTrigger>
                <SelectContent>{profiles.map((item) => <SelectItem key={item.cdPerfil} value={String(item.cdPerfil)}>{item.dsPerfil}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {establishments.length > 0 && (
            <div className="grid gap-2">
              <Label>Estabelecimento</Label>
              <Select value={establishment} onValueChange={setEstablishment}>
                <SelectTrigger><SelectValue placeholder="Selecione o estabelecimento" /></SelectTrigger>
                <SelectContent>{establishments.map((item) => <SelectItem key={item.cdEstabelecimento} value={String(item.cdEstabelecimento)}>{item.dsEstabelecimento}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <Button onClick={submit} disabled={!options.data || save.isPending || !profiles.length || !establishments.length}>
            {save.isPending ? "Validando no Tasy..." : "Continuar"}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
