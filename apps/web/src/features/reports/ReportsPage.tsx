import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { REPORT_TYPES, fromMinor, type ReportType } from '@innovexa/shared';
import { Button } from '@/components/ui/button';
import { TableShell, Tabs, td, th } from '@/components/ui/extra';
import { Field, FormAlert, Input, Select } from '@/components/ui/form';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { useClientOptions, usePartnerOptions, useProjectOptions } from '@/features/admin/options';
import { api, errorMessage, getData } from '@/lib/api';
import { money } from '@/lib/format';
import { fromDateInput } from '@/lib/hooks';

const LABELS: Record<ReportType, string> = {
  projects: 'Project completion',
  partners: 'Partner productivity',
  work: 'Work reports',
  'overdue-tasks': 'Overdue tasks',
  financial: 'Revenue & balances',
};

interface Report {
  title: string;
  columns: { key: string; label: string; money?: boolean }[];
  rows: Record<string, string | number | boolean>[];
  totals?: Record<string, string | number>;
}

export function ReportsPage() {
  const [search] = useSearchParams();
  const [type, setType] = useState<ReportType>(
    (REPORT_TYPES as readonly string[]).includes(search.get('type') ?? '')
      ? (search.get('type') as ReportType)
      : 'projects',
  );
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [partnerId, setPartnerId] = useState(search.get('partnerId') ?? '');
  const clients = useClientOptions();
  const projects = useProjectOptions();
  const partners = usePartnerOptions();
  const params = {
    ...(from && { from: fromDateInput(from) }),
    ...(to && { to: new Date(`${to}T23:59:59.999Z`).toISOString() }),
    ...(clientId && { clientId }),
    ...(projectId && { projectId }),
    ...(partnerId && { partnerId }),
  };
  const report = useQuery({
    queryKey: ['reports', type, params],
    queryFn: async () => (await getData<Report>(`/reports/${type}`, params)).data,
  });

  const download = async () => {
    const res = await api.get(`/reports/${type}`, {
      params: { ...params, format: 'csv' },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `innovexa-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const fmt = (c: Report['columns'][number], v: unknown) =>
    c.money && typeof v === 'number'
      ? money(v)
      : typeof v === 'boolean'
        ? v
          ? 'Yes'
          : 'No'
        : v === undefined || v === ''
          ? '—'
          : String(v);

  return (
    <>
      <PageHeader
        title="Reports & analytics"
        description="Totals are computed directly from the database records."
        actions={
          <>
            <Button variant="secondary" onClick={() => void download()}>
              <Download /> Export CSV
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer /> Print / PDF
            </Button>
          </>
        }
      />
      <Tabs
        tabs={REPORT_TYPES.map((t) => ({ value: t, label: LABELS[t] }))}
        value={type}
        onChange={setType}
      />
      <Card className="mb-4 print:hidden">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="From" htmlFor="r-from">
            <Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="r-to">
            <Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Client" htmlFor="r-client">
            <Select id="r-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">All</option>
              {clients.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project" htmlFor="r-project">
            <Select id="r-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectCode} {p.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Partner" htmlFor="r-partner">
            <Select id="r-partner" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">All</option>
              {partners.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
      <Card>
        {report.isLoading ? (
          <Skeleton className="m-4 h-40" />
        ) : report.isError ? (
          <div className="p-4">
            <FormAlert>{errorMessage(report.error)}</FormAlert>
          </div>
        ) : report.data!.rows.length === 0 ? (
          <EmptyState
            icon={<BarChart3 />}
            title="No data for these filters"
            description="Adjust the date range or filters."
          />
        ) : (
          <>
            <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-800">
              {report.data!.title} · {report.data!.rows.length} rows
            </div>
            <TableShell minWidth={900}>
              <thead>
                <tr>
                  {report.data!.columns.map((c) => (
                    <th key={c.key} className={`${th} ${c.money ? 'text-right' : ''}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.data!.rows.map((r, i) => (
                  <tr key={i}>
                    {report.data!.columns.map((c) => (
                      <td
                        key={c.key}
                        className={`${td} ${c.money ? 'text-right tabular-nums' : ''} max-w-xs whitespace-pre-wrap`}
                      >
                        {fmt(c, r[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {report.data!.totals && (
                <tfoot className="border-t-2 border-slate-200 font-semibold">
                  <tr>
                    {report.data!.columns.map((c) => (
                      <td
                        key={c.key}
                        className={`${td} ${c.money ? 'text-right tabular-nums' : ''}`}
                      >
                        {report.data!.totals![c.key] !== undefined
                          ? fmt(c, report.data!.totals![c.key])
                          : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </TableShell>
          </>
        )}
      </Card>
      <p className="mt-2 text-xs text-slate-500">
        CSV money columns are exported as plain decimals (e.g. {fromMinor(123450)}) for
        spreadsheets.
      </p>
    </>
  );
}
