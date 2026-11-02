import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  INSTALLMENT_PLAN_MONTHS,
  InvoiceStatus,
  OFFLINE_PAYMENT_METHODS,
  PaymentTerms,
  buildSchedule,
  fromMinor,
  invoiceTotal,
  percentOf,
  toMinor,
  type InstallmentPlan,
} from '@innovexa/shared';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  Pagination,
  StatTile,
  StatusBadge,
  TableShell,
  Tabs,
  Textarea,
  td,
  th,
} from '@/components/ui/extra';
import { Field, FormAlert, Input, Select } from '@/components/ui/form';
import { Card, Dialog, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { InvoiceDetailPage, PaymentHistoryPage, useInvoiceAction } from '@/features/billing/shared';
import { errorMessage, getData, postData } from '@/lib/api';
import { money } from '@/lib/format';
import { fromDateInput, toDateInput } from '@/lib/hooks';
import { formatDate, humanize } from '@/lib/utils';
import type { BillingTotals, Invoice } from '@/types';
import { useProjectOptions } from './options';

const safeMinor = (v: string) => {
  try {
    return v.trim() ? toMinor(v) : 0;
  } catch {
    return NaN;
  }
};

export function InvoicesPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'invoices' | 'payments'>('invoices');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(!!params.get('new'));
  const q = { page, limit: 20, ...(status && { status }) };
  const invoices = useQuery({
    queryKey: ['invoices', q],
    queryFn: () => getData<Invoice[]>('/invoices', q),
    placeholderData: keepPreviousData,
  });
  const totals = useQuery({
    queryKey: ['dashboard', 'admin', 'billing'],
    queryFn: async () =>
      (await getData<{ billing: BillingTotals }>('/dashboard/admin')).data.billing,
  });

  return (
    <>
      <PageHeader
        title="Invoices & payments"
        description="Invoices, instalment schedules, offline payments and receipts."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New invoice
          </Button>
        }
      />
      {totals.data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Total invoiced"
            value={money(totals.data.invoicedMinor)}
            hint={`${totals.data.invoiceCount} issued invoices`}
          />
          <StatTile label="Received" value={money(totals.data.receivedMinor)} tone="green" />
          <StatTile
            label="Advance collected"
            value={money(totals.data.advancePaidMinor)}
            hint={`of ${money(totals.data.advanceDueMinor)}`}
            tone="green"
          />
          <StatTile label="Outstanding" value={money(totals.data.outstandingMinor)} tone="amber" />
        </div>
      )}
      <Tabs
        tabs={[
          { value: 'invoices', label: 'Invoices' },
          { value: 'payments', label: 'Payments' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'payments' ? (
        <PaymentHistoryPage />
      ) : (
        <Card>
          <div className="border-b border-slate-100 p-4">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="sm:w-48"
              aria-label="Status"
            >
              <option value="">All statuses</option>
              {Object.values(InvoiceStatus).map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </div>
          {invoices.isLoading ? (
            <Skeleton className="m-4 h-32" />
          ) : invoices.isError ? (
            <div className="p-4">
              <FormAlert>{errorMessage(invoices.error)}</FormAlert>
            </div>
          ) : invoices.data!.data.length === 0 ? (
            <EmptyState
              icon={<FileText />}
              title="No invoices"
              description="Create an invoice for a client project."
            />
          ) : (
            <TableShell minWidth={900}>
              <thead>
                <tr>
                  <th className={th}>Invoice</th>
                  <th className={th}>Client / project</th>
                  <th className={th}>Terms</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Paid</th>
                  <th className={`${th} text-right`}>Balance</th>
                  <th className={th}>Next due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.data!.data.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50/60">
                    <td className={td}>
                      <Link
                        to={`/admin/invoices/${i.id}`}
                        className="font-medium text-slate-900 hover:text-brand-700"
                      >
                        {i.invoiceNumber}
                      </Link>
                      <div className="text-xs text-slate-500">{formatDate(i.invoiceDate)}</div>
                    </td>
                    <td className={td}>
                      {i.client?.companyName}
                      <div className="text-xs text-slate-500">
                        {i.project?.projectCode} {i.project?.title}
                      </div>
                    </td>
                    <td className={td}>{humanize(i.paymentTerms)}</td>
                    <td className={td}>
                      <StatusBadge status={i.status} />
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{money(i.totalMinor)}</td>
                    <td className={`${td} text-right tabular-nums`}>{money(i.paidMinor)}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {money(Math.max(0, i.balanceMinor))}
                    </td>
                    <td className={td}>
                      {i.nextDue
                        ? `${money(i.nextDue.dueMinor)} · ${formatDate(i.nextDue.dueDate)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
          <Pagination meta={invoices.data?.meta} onPage={setPage} />
        </Card>
      )}
      {creating && (
        <InvoiceFormDialog
          initialProjectId={params.get('new') ?? ''}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

function InvoiceFormDialog({
  initialProjectId,
  onClose,
}: {
  initialProjectId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const projects = useProjectOptions();
  const today = toDateInput(new Date());
  const [f, setF] = useState({
    projectId: initialProjectId,
    invoiceDate: today,
    dueDate: toDateInput(new Date(Date.now() + 30 * 86_400_000)),
    contract: '',
    taxPercent: '18',
    discount: '',
    terms: PaymentTerms.ADVANCE_BALANCE as string,
    advance: '',
    advanceDueDate: today,
    planMode: 'MONTHLY' as 'MONTHLY' | 'CUSTOM',
    months: '3',
    firstDueDate: toDateInput(new Date(Date.now() + 30 * 86_400_000)),
    notes: '',
  });
  const [custom, setCustom] = useState<{ amount: string; dueDate: string }[]>([
    { amount: '', dueDate: '' },
  ]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const project = projects.data?.find((p) => p.id === f.projectId);

  // Live preview with the exact same maths the server uses.
  const preview = useMemo(() => {
    try {
      const contractAmountMinor = safeMinor(f.contract);
      const taxMinor = percentOf(contractAmountMinor, Math.round(Number(f.taxPercent || 0) * 100));
      const discountMinor = safeMinor(f.discount);
      const totalMinor = invoiceTotal({ contractAmountMinor, taxMinor, discountMinor });
      const advanceMinor = f.terms === PaymentTerms.FULL ? 0 : safeMinor(f.advance);
      const installments: InstallmentPlan | undefined =
        f.terms !== PaymentTerms.INSTALLMENTS
          ? undefined
          : f.planMode === 'MONTHLY'
            ? {
                mode: 'MONTHLY',
                months: Number(f.months),
                firstDueDate: new Date(fromDateInput(f.firstDueDate)!),
              }
            : {
                mode: 'CUSTOM',
                items: custom.map((c) => ({
                  amountMinor: safeMinor(c.amount),
                  dueDate: new Date(fromDateInput(c.dueDate) ?? Date.now()),
                })),
              };
      const rows = buildSchedule({
        totalMinor,
        paymentTerms: f.terms as PaymentTerms,
        dueDate: new Date(fromDateInput(f.dueDate)!),
        advanceMinor,
        advanceDueDate: advanceMinor ? new Date(fromDateInput(f.advanceDueDate)!) : undefined,
        installments,
      });
      return {
        ok: true as const,
        contractAmountMinor,
        taxMinor,
        discountMinor,
        totalMinor,
        advanceMinor,
        installments,
        rows,
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Check the amounts' };
    }
  }, [f, custom]);

  const create = useMutation({
    mutationFn: (issue: boolean) => {
      if (!preview.ok) throw new Error(preview.error);
      return postData<Invoice>('/invoices', {
        projectId: f.projectId,
        invoiceDate: fromDateInput(f.invoiceDate),
        dueDate: fromDateInput(f.dueDate),
        contractAmountMinor: preview.contractAmountMinor,
        taxMinor: preview.taxMinor,
        discountMinor: preview.discountMinor,
        paymentTerms: f.terms,
        advanceMinor: preview.advanceMinor,
        ...(preview.advanceMinor > 0 && { advanceDueDate: fromDateInput(f.advanceDueDate) }),
        ...(preview.installments && { installments: preview.installments }),
        ...(f.notes && { notes: f.notes }),
        issue,
      });
    },
    onSuccess: (inv, issue) => {
      toast.success(issue ? 'Invoice issued to the client' : 'Draft invoice saved');
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      onClose();
      navigate(`/admin/invoices/${inv.id}`);
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="New invoice"
      description="Amounts are in rupees; totals are computed exactly in paise."
      className="sm:max-w-3xl"
    >
      <div className="space-y-4">
        {create.isError && (
          <FormAlert>
            {create.error instanceof Error && !('isAxiosError' in create.error)
              ? create.error.message
              : errorMessage(create.error)}
          </FormAlert>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Project" htmlFor="i-project" className="sm:col-span-3">
            <Select
              id="i-project"
              value={f.projectId}
              onChange={(e) => {
                const p = projects.data?.find((x) => x.id === e.target.value);
                setF((x) => ({
                  ...x,
                  projectId: e.target.value,
                  contract:
                    p?.contractAmountMinor != null && !x.contract
                      ? fromMinor(p.contractAmountMinor)
                      : x.contract,
                }));
              }}
            >
              <option value="">Select a project…</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectCode} · {p.title} · {p.client?.companyName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Invoice date" htmlFor="i-date">
            <Input id="i-date" type="date" value={f.invoiceDate} onChange={set('invoiceDate')} />
          </Field>
          <Field label="Final due date" htmlFor="i-due">
            <Input id="i-due" type="date" value={f.dueDate} onChange={set('dueDate')} />
          </Field>
          <Field
            label="Contract amount (₹)"
            htmlFor="i-contract"
            hint={
              project?.contractAmountMinor != null
                ? `Project contract ${money(project.contractAmountMinor)}`
                : undefined
            }
          >
            <Input
              id="i-contract"
              inputMode="decimal"
              value={f.contract}
              onChange={set('contract')}
            />
          </Field>
          <Field label="Tax %" htmlFor="i-tax">
            <Input
              id="i-tax"
              inputMode="decimal"
              value={f.taxPercent}
              onChange={set('taxPercent')}
            />
          </Field>
          <Field label="Discount (₹)" htmlFor="i-disc">
            <Input id="i-disc" inputMode="decimal" value={f.discount} onChange={set('discount')} />
          </Field>
          <Field label="Payment option" htmlFor="i-terms">
            <Select id="i-terms" value={f.terms} onChange={set('terms')}>
              <option value={PaymentTerms.FULL}>Full payment</option>
              <option value={PaymentTerms.ADVANCE_BALANCE}>Advance + balance</option>
              <option value={PaymentTerms.INSTALLMENTS}>EMI / instalments</option>
            </Select>
          </Field>
          {f.terms !== PaymentTerms.FULL && (
            <>
              <Field label="Advance amount (₹)" htmlFor="i-adv">
                <Input id="i-adv" inputMode="decimal" value={f.advance} onChange={set('advance')} />
              </Field>
              <Field label="Advance due" htmlFor="i-adv-due">
                <Input
                  id="i-adv-due"
                  type="date"
                  value={f.advanceDueDate}
                  onChange={set('advanceDueDate')}
                />
              </Field>
            </>
          )}
          {f.terms === PaymentTerms.INSTALLMENTS && (
            <>
              <Field label="Plan" htmlFor="i-mode">
                <Select id="i-mode" value={f.planMode} onChange={set('planMode')}>
                  <option value="MONTHLY">Monthly</option>
                  <option value="CUSTOM">Custom</option>
                </Select>
              </Field>
              {f.planMode === 'MONTHLY' && (
                <>
                  <Field label="Months" htmlFor="i-months">
                    <Select id="i-months" value={f.months} onChange={set('months')}>
                      {INSTALLMENT_PLAN_MONTHS.map((m) => (
                        <option key={m} value={m}>
                          {m} months
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="First instalment due" htmlFor="i-first">
                    <Input
                      id="i-first"
                      type="date"
                      value={f.firstDueDate}
                      onChange={set('firstDueDate')}
                    />
                  </Field>
                </>
              )}
            </>
          )}
        </div>
        {f.terms === PaymentTerms.INSTALLMENTS && f.planMode === 'CUSTOM' && (
          <div className="space-y-2">
            {custom.map((c, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  placeholder={`Instalment ${i + 1} amount (₹)`}
                  inputMode="decimal"
                  value={c.amount}
                  onChange={(e) =>
                    setCustom((all) =>
                      all.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
                    )
                  }
                  aria-label={`Instalment ${i + 1} amount`}
                />
                <Input
                  type="date"
                  className="w-44"
                  value={c.dueDate}
                  onChange={(e) =>
                    setCustom((all) =>
                      all.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)),
                    )
                  }
                  aria-label={`Instalment ${i + 1} due date`}
                />
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCustom((c) => [...c, { amount: '', dueDate: '' }])}
            >
              <Plus /> Add instalment
            </Button>
          </div>
        )}
        <Field label="Notes / payment terms text" htmlFor="i-notes">
          <Textarea id="i-notes" value={f.notes} onChange={set('notes')} className="min-h-16" />
        </Field>

        <Card className="bg-slate-50 p-4">
          <div className="mb-2 text-sm font-semibold text-slate-800">Schedule preview</div>
          {!preview.ok ? (
            <p className="text-sm text-amber-700">{preview.error}</p>
          ) : (
            <>
              <div className="mb-2 text-sm text-slate-600">
                Contract {money(preview.contractAmountMinor)} + tax {money(preview.taxMinor)} −
                discount {money(preview.discountMinor)} ={' '}
                <strong>{money(preview.totalMinor)}</strong>
              </div>
              <ul className="space-y-1 text-sm">
                {preview.rows.map((r) => (
                  <li key={r.number} className="flex justify-between">
                    <span>
                      {humanize(r.kind)} {r.kind === 'INSTALLMENT' ? `#${r.number}` : ''} ·{' '}
                      {formatDate(r.dueDate)}
                    </span>
                    <span className="tabular-nums">{money(r.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => create.mutate(false)}
            loading={create.isPending && create.variables === false}
            disabled={!f.projectId || !preview.ok}
          >
            Save draft
          </Button>
          <Button
            onClick={() => create.mutate(true)}
            loading={create.isPending && create.variables === true}
            disabled={!f.projectId || !preview.ok}
          >
            Issue invoice
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RecordPaymentDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(
    invoice.nextDue
      ? fromMinor(invoice.nextDue.dueMinor)
      : fromMinor(Math.max(0, invoice.balanceMinor)),
  );
  const [method, setMethod] = useState<string>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(toDateInput(new Date()));
  const record = useMutation({
    mutationFn: () =>
      postData('/payments/offline', {
        invoiceId: invoice.id,
        amountMinor: toMinor(amount),
        method,
        ...(reference && { reference }),
        paidAt: fromDateInput(paidAt),
      }),
    onSuccess: () => {
      toast.success('Payment recorded and receipt generated');
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['payments'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Record offline payment"
      description={`Outstanding balance ${money(Math.max(0, invoice.balanceMinor))}. Payments settle the advance first, then instalments in order.`}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          record.mutate();
        }}
      >
        {record.isError && <FormAlert>{errorMessage(record.error)}</FormAlert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (₹)" htmlFor="rp-amount">
            <Input
              id="rp-amount"
              inputMode="decimal"
              required
              pattern="^\d+(\.\d{1,2})?$"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Paid on" htmlFor="rp-date">
            <Input
              id="rp-date"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </Field>
          <Field label="Method" htmlFor="rp-method">
            <Select id="rp-method" value={method} onChange={(e) => setMethod(e.target.value)}>
              {OFFLINE_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {humanize(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference (UTR / cheque no.)" htmlFor="rp-ref">
            <Input id="rp-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={record.isPending}>
            <Wallet /> Record payment
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AdminInvoiceActions({ invoice }: { invoice: Invoice }) {
  const [recording, setRecording] = useState(false);
  const issue = useInvoiceAction(invoice.id, 'issue');
  const cancel = useInvoiceAction(invoice.id, 'cancel');
  const payable = [
    InvoiceStatus.ISSUED,
    InvoiceStatus.PARTIALLY_PAID,
    InvoiceStatus.OVERDUE,
  ].includes(invoice.status as never);
  return (
    <>
      {invoice.status === InvoiceStatus.DRAFT && (
        <Button onClick={() => issue.setConfirming(true)}>Issue to client</Button>
      )}
      {payable && (
        <Button onClick={() => setRecording(true)}>
          <Wallet /> Record payment
        </Button>
      )}
      {invoice.paidMinor === 0 && invoice.status !== InvoiceStatus.CANCELLED && (
        <Button variant="ghost" onClick={() => cancel.setConfirming(true)}>
          Cancel invoice
        </Button>
      )}
      {recording && <RecordPaymentDialog invoice={invoice} onClose={() => setRecording(false)} />}
      <ConfirmDialog
        open={issue.confirming}
        title="Issue this invoice?"
        description="The client is notified by email and can see the payment schedule."
        confirmLabel="Issue"
        loading={issue.isPending}
        onConfirm={() => issue.mutate()}
        onClose={() => issue.setConfirming(false)}
      />
      <ConfirmDialog
        open={cancel.confirming}
        title="Cancel this invoice?"
        description="Cancelled invoices are kept for records but cannot be paid."
        confirmLabel="Cancel invoice"
        danger
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onClose={() => cancel.setConfirming(false)}
      />
    </>
  );
}

export function AdminInvoiceDetailPage() {
  return <InvoiceDetailPage adminActions={(inv) => <AdminInvoiceActions invoice={inv} />} />;
}
