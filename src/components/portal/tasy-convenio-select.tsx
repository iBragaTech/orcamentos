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

type ConvenioItem = { codigo: string; nome: string };
type ConvenioPage = { items: ConvenioItem[]; hasMore: boolean };

const format = (item: ConvenioItem) => `${item.codigo} - ${item.nome}`;

export function TasyConvenioSelect({
  value,
  onChange,
  placeholder = "Pesquisar convênio...",
}: {
  value: string;
  onChange: (convenio: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const term = query.trim();
  const results = useQuery({
    queryKey: ["tasy", "convenios", term, offset],
    enabled: open,
    retry: false,
    queryFn: () =>
      getTasyClient().executeOperation<ConvenioPage>("catalogos.convenios", {
        busca: term,
        offset,
      }),
  });

  function select(item: ConvenioItem) {
    const label = format(item);
    onChange(value === label ? "" : label);
    setOpen(false);
  }

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Convênio"
          className="h-10 w-full justify-between font-normal"
        >
          <span className="truncate text-left">{value || placeholder}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar por nome ou código..."
            value={query}
            onValueChange={(next) => {
              setQuery(next);
              setOffset(0);
            }}
          />
          <CommandList className="max-h-64 overflow-y-auto overscroll-contain">
            <CommandEmpty>
              {results.isFetching
                ? "Consultando convênios..."
                : "Nenhum convênio ativo encontrado."}
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
              <CommandGroup heading="Convênios ativos no Tasy">
                {results.data.items.map((item) => (
                  <CommandItem
                    key={item.codigo}
                    value={format(item)}
                    onSelect={() => select(item)}
                  >
                    <Check
                      className={cn(
                        "h-4 w-4",
                        value === format(item) ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 truncate text-sm">{format(item)}</span>
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
  );
}
