import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getTasyClient } from "@/lib/data/tasy-supabase";
import { ItemQuantity } from "./item-quantity";
import type { ProcedureSelectionItem } from "@/data/procedure-catalog";

type InternalProcedure = ProcedureSelectionItem & {
  nrSequencia: string;
  cdProcedimento: string | null;
};

type InternalProcedureRow = Omit<InternalProcedure, "quantidade" | "origem">;
type InternalProcedurePage = { items: InternalProcedureRow[]; hasMore: boolean };

export function TasyInternalProcedureSelect({
  value,
  onChange,
  multiple = false,
  placeholder = "Pesquisar procedimento...",
}: {
  value: ProcedureSelectionItem[];
  onChange: (value: ProcedureSelectionItem[]) => void;
  multiple?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const term = query.trim();
  const results = useQuery({
    queryKey: ["tasy", "procedimentos-internos", term, offset],
    enabled: open && term.length >= 2,
    retry: false,
    queryFn: async () => {
      const page = await getTasyClient().executeOperation<InternalProcedurePage>(
        "catalogos.procedimentos-internos",
        { busca: term, offset },
      );
      return {
        ...page,
        items: page.items.map((item) => ({ ...item, quantidade: 1, origem: "catalogo" as const })),
      };
    },
  });

  function toggle(item: InternalProcedure) {
    const selected = value.some((current) => current.codigo === item.codigo);
    if (!multiple) {
      onChange(selected ? [] : [item]);
      setOpen(false);
      return;
    }
    onChange(selected ? value.filter((current) => current.codigo !== item.codigo) : [...value, item]);
  }

  const label =
    value.length === 0
      ? placeholder
      : multiple
        ? `${value.length} procedimento(s) selecionado(s)`
        : `${value[0]?.cdProcedimento || value[0]?.codigo} · ${value[0]?.nome}`;

  return (
    <div className="grid gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-10 w-full justify-between font-normal"
          >
            <span className="truncate text-left">{label}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar por descrição ou código..."
              value={query}
              onValueChange={(next) => {
                setQuery(next);
                setOffset(0);
              }}
            />
            <CommandList>
              <CommandEmpty>
                {term.length < 2
                  ? "Digite ao menos 2 caracteres para pesquisar."
                  : results.isFetching
                    ? "Consultando procedimentos..."
                    : "Nenhum procedimento interno encontrado."}
              </CommandEmpty>
              {results.error && (
                <p role="alert" className="px-3 py-2 text-sm text-destructive">
                  {results.error.message}
                </p>
              )}
              {results.isFetching && results.data && (
                <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
                  Atualizando resultados...
                </p>
              )}
              {!!results.data?.items.length && (
                <CommandGroup heading="Procedimentos internos do Tasy">
                  {results.data.items.map((item) => (
                    <CommandItem
                      key={item.nrSequencia}
                      value={`${item.nrSequencia} ${item.cdProcedimento ?? ""} ${item.nome}`}
                      onSelect={() => toggle(item)}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4",
                          value.some((current) => current.codigo === item.codigo)
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <span className="min-w-0 truncate text-sm">
                        {item.cdProcedimento ? `${item.cdProcedimento} · ` : ""}
                        {item.nome}
                        <span className="text-muted-foreground"> · Seq. {item.nrSequencia}</span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
          {(offset > 0 || results.data?.hasMore) && (
            <div className="flex justify-between border-t p-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!offset || results.isFetching}
                onClick={() => setOffset((current) => Math.max(0, current - 100))}
              >
                Anteriores
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!results.data?.hasMore || results.isFetching}
                onClick={() => setOffset((current) => current + 100)}
              >
                Próximos
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {value.map((item) => (
        <div
          key={`${item.origem}:${item.codigo}`}
          className="grid items-center gap-3 border-b py-2 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_5rem_auto]"
        >
          <span className="min-w-0 break-words">
            {item.cdProcedimento ? `${item.cdProcedimento} - ` : ""}
            {item.nome}
          </span>
          <ItemQuantity
            inline
            name={item.nome}
            value={item.quantidade}
            onChange={(quantidade) =>
              onChange(
                value.map((current) =>
                  current.codigo === item.codigo ? { ...current, quantidade } : current,
                ),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            className="justify-self-start sm:justify-self-end"
            aria-label={`Remover ${item.nome}`}
            onClick={() => toggle(item as InternalProcedure)}
          >
            Remover
          </Button>
        </div>
      ))}
    </div>
  );
}
