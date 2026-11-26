import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMyTasyOptions, useSaveMyTasyLink } from "@/lib/data/hooks";

export function TasyAccessDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const options = useMyTasyOptions(open);
  const save = useSaveMyTasyLink();
  const [profile, setProfile] = useState("");
  const [establishment, setEstablishment] = useState("");

  useEffect(() => {
    if (!options.data) return;
    setProfile(options.data.selectedProfile ? String(options.data.selectedProfile) : "");
    setEstablishment(
      options.data.selectedEstablishment ? String(options.data.selectedEstablishment) : "",
    );
  }, [options.data]);

  async function submit() {
    if (!profile || !establishment) {
      toast.error("Selecione o perfil e o estabelecimento Tasy.");
      return;
    }
    try {
      await save.mutateAsync({
        cdPerfil: Number(profile),
        cdEstabelecimento: Number(establishment),
      });
      toast.success("Acesso Tasy atualizado.");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o acesso Tasy.");
    }
  }

  const profiles = options.data?.profiles ?? [];
  const establishments = options.data?.establishments ?? [];
  const currentProfile = profiles.find((item) => String(item.cdPerfil) === profile)?.dsPerfil;
  const currentEstablishment = establishments.find(
    (item) => String(item.cdEstabelecimento) === establishment,
  )?.dsEstabelecimento;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Perfil e estabelecimento Tasy</DialogTitle>
          <DialogDescription>
            Selecione uma combinação liberada para seu usuário no Tasy. A alteração será aplicada às próximas consultas do portal.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {options.isLoading && (
            <p className="text-sm text-muted-foreground">Consultando seus acessos no Tasy...</p>
          )}
          {options.error && (
            <p role="alert" className="text-sm text-destructive">
              {options.error instanceof Error
                ? options.error.message
                : "Não foi possível consultar seus acessos no Tasy."}
            </p>
          )}
          {options.data && (!profiles.length || !establishments.length) && (
            <p role="alert" className="text-sm text-destructive">
              Não foram encontrados perfis ativos e estabelecimentos disponíveis para seu usuário.
            </p>
          )}
          {profiles.length > 0 && (
            <div className="grid gap-2">
              <Label>Perfil Tasy</Label>
              <Select value={profile} onValueChange={setProfile}>
                <SelectTrigger><SelectValue placeholder="Selecione o perfil" /></SelectTrigger>
                <SelectContent>
                  {profiles.map((item) => (
                    <SelectItem key={item.cdPerfil} value={String(item.cdPerfil)}>
                      {item.dsPerfil}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {establishments.length > 0 && (
            <div className="grid gap-2">
              <Label>Estabelecimento</Label>
              <Select value={establishment} onValueChange={setEstablishment}>
                <SelectTrigger><SelectValue placeholder="Selecione o estabelecimento" /></SelectTrigger>
                <SelectContent>
                  {establishments.map((item) => (
                    <SelectItem key={item.cdEstabelecimento} value={String(item.cdEstabelecimento)}>
                      {item.dsEstabelecimento}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {currentProfile && currentEstablishment && (
            <p className="text-xs text-muted-foreground">
              Seleção atual: {currentProfile} · {currentEstablishment}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!options.data || save.isPending || !profiles.length || !establishments.length}
          >
            {save.isPending ? "Validando no Tasy..." : "Aplicar acesso"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
