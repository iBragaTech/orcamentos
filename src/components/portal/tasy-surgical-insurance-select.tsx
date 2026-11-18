import { useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
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

export type TasySurgicalInsurance = { codigo: string; nome: string };
type Page = { items: TasySurgicalInsurance[]; hasMore: boolean };

export function TasySurgicalInsuranceSelect({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (item: TasySurgicalInsurance) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  const results = useInfiniteQuery({
    queryKey: ["tasy", "convenios-cirurgia", search],
    initialPageParam: 0,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ pageParam }) =>
      getTasyClient().executeOperation<Page>("catalogos.convenios", {
        busca: search,
        offset: pageParam,
        limit: 10,
      }),
    getNextPageParam: (lastPage, pages) =>
      lastPage.hasMore ? pages.length * 10 : undefined,
  });
  const items = results.data?.pages.flatMap((page) => page.items) ?? [];
  const loadMore = useCallback(() => {
    const list = listRef.current;
    if (
      list &&
      list.scrollHeight - list.scrollTop - list.clientHeight < 80 &&
      results.hasNextPage &&
      !results.isFetchingNextPage
    )
      void results.fetchNextPage();
  }, [results.fetchNextPage, results.hasNextPage, results.isFetchingNextPage]);

  useEffect(() => {
    const root = listRef.current;
    const sentinel = loadMoreRef.current;
    if (!open || !root || !sentinel || !results.hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !results.isFetchingNextPage) void results.fetchNextPage();
      },
      { root, rootMargin: "0px 0px 80px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [open, results.fetchNextPage, results.hasNextPage, results.isFetchingNextPage, items.length]);

  return (
    <div className="grid gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Selecionar convênio Tasy"
            className="h-10 w-full justify-between font-normal"
          >
            <span className="truncate text-left">
              {value ? label : "Pesquisar convênio..."}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1rem)] p-0"
          align="start"
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar por nome ou código..."
              value={query}
              onValueChange={setQuery}
            />
            <CommandList
              ref={listRef}
              className="max-h-64"
              onScroll={loadMore}
              onWheel={() => requestAnimationFrame(loadMore)}
            >
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
              {!!items.length && (
                <CommandGroup heading="Convênios ativos no Tasy">
                  {items.map((item) => (
                    <CommandItem
                      key={item.codigo}
                      value={`${item.codigo} ${item.nome}`}
                      onSelect={() => {
                        onChange(item);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn("h-4 w-4", item.codigo === value ? "opacity-100" : "opacity-0")}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {item.codigo} - {item.nome}
                      </span>
                    </CommandItem>
                  ))}
                  {results.hasNextPage && <div ref={loadMoreRef} className="h-px" aria-hidden />}
                </CommandGroup>
              )}
            </CommandList>
            {results.isFetchingNextPage && (
              <p role="status" className="border-t px-3 py-2 text-xs text-muted-foreground">
                Carregando mais convênios…
              </p>
            )}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
