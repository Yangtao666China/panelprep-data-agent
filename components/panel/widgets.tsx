"use client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RecordRow } from "@/lib/panelprep";
export const count = (n: number) => n.toLocaleString("zh-CN");
export const items = (columns: string[]) =>
  columns.map((c) => ({ value: c, label: c }));
export function Choice({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className="choice" aria-label={label}>
        <SelectValue placeholder="请选择" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function Preview({
  columns,
  rows,
  onTrace,
  recordNumbers,
}: {
  columns: string[];
  rows: RecordRow[];
  recordNumbers?: number[];
  onTrace?: (i: number) => void;
}) {
  return (
    <div className="table-wrap">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{onTrace ? "来源" : "记录号"}</TableHead>
            {columns.map((c) => (
              <TableHead key={c}>{c}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 30).map((r, i) => (
            <TableRow key={i}>
              <TableCell>
                {onTrace ? (
                  <button className="trace-link" onClick={() => onTrace(i)}>
                    #{i + 1}
                  </button>
                ) : (
                  <span className="muted">{recordNumbers?.[i] ?? i + 2}</span>
                )}
              </TableCell>
              {columns.map((c) => (
                <TableCell key={c}>
                  <span className="raw-cell">
                    {r[c] ?? <span className="null-cell">空</span>}
                  </span>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
export function saveFile(
  name: string,
  text: string,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
