"use client";

import { Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CategoryBadge, PageHeader } from "@/components/common";
import { kpis, meta, updates2026 } from "@/lib/data";

export default function KpisPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="KPI辞典"
        description="各指標の定義・計算式・確認場所・2026年の目安をまとめています。"
      />

      <Card className="border-primary/30 bg-accent/40">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="size-5 text-primary shrink-0 mt-0.5" />
          <p className="text-sm leading-relaxed">{meta.benchmark_note}</p>
        </CardContent>
      </Card>

      <Tabs defaultValue="dict">
        <TabsList>
          <TabsTrigger value="dict">KPI辞典</TabsTrigger>
          <TabsTrigger value="updates">2026年に変わったこと</TabsTrigger>
        </TabsList>

        <TabsContent value="dict">
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>指標</TableHead>
                    <TableHead>定義・計算式</TableHead>
                    <TableHead>確認場所</TableHead>
                    <TableHead>2026年の目安</TableHead>
                    <TableHead>補足</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kpis.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-semibold whitespace-nowrap align-top">
                        {k.name}
                      </TableCell>
                      <TableCell className="min-w-52 align-top">
                        {k.definition}
                      </TableCell>
                      <TableCell className="min-w-40 align-top text-muted-foreground">
                        {k.where}
                      </TableCell>
                      <TableCell className="min-w-32 align-top font-medium">
                        {k.benchmark2026}
                      </TableCell>
                      <TableCell className="min-w-52 align-top text-muted-foreground text-xs leading-relaxed">
                        {k.note}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="updates">
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>領域</TableHead>
                    <TableHead>元の常識</TableHead>
                    <TableHead>2026年の評価・更新</TableHead>
                    <TableHead>区分</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {updates2026.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-semibold whitespace-nowrap align-top">
                        {u.area}
                      </TableCell>
                      <TableCell className="min-w-40 align-top text-muted-foreground">
                        {u.before}
                      </TableCell>
                      <TableCell className="min-w-64 align-top leading-relaxed">
                        {u.after}
                      </TableCell>
                      <TableCell className="align-top">
                        <CategoryBadge category={u.category} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
