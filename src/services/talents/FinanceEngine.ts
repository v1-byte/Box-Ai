import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  TalentEngine,
  TalentResult,
  ToolDefinition,
  TalentExecuteContext,
} from './types';

const STORAGE_KEY = 'boxai.finance.entries.v1';

export type FinanceEntry = {
  id: string;
  amount: number; // positive = expense in IDR unless type says income
  type: 'expense' | 'income';
  note: string;
  at: string; // ISO
};

async function loadEntries(): Promise<FinanceEntry[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveEntries(entries: FinanceEntry[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/**
 * Catat keuangan lokal (Indonesia) — 100% on-device.
 * Contoh: "catat 20000 bensin" → expense 20000, note bensin
 */
export class FinanceEngine implements TalentEngine {
  readonly name = 'finance';

  async execute(
    args: Record<string, any>,
    _ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const action = typeof args.action === 'string' ? args.action : 'add';

    try {
      if (action === 'add') {
        const amount = Number(args.amount);
        if (!Number.isFinite(amount) || amount === 0) {
          return {
            type: 'error',
            summary: 'finance: amount harus angka valid',
            errorMessage: 'invalid amount',
          };
        }
        const type: 'expense' | 'income' =
          args.type === 'income' ? 'income' : 'expense';
        const note = typeof args.note === 'string' ? args.note : '';
        const entry: FinanceEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          amount: Math.abs(amount),
          type,
          note,
          at: new Date().toISOString(),
        };
        const entries = await loadEntries();
        entries.push(entry);
        await saveEntries(entries);
        const label = type === 'income' ? 'Pemasukan' : 'Pengeluaran';
        return {
          type: 'text',
          summary: `${label} dicatat: Rp ${entry.amount.toLocaleString('id-ID')}${note ? ` (${note})` : ''}. Total entri: ${entries.length}.`,
        };
      }

      if (action === 'summary') {
        const entries = await loadEntries();
        const month = typeof args.month === 'string' ? args.month : null; // YYYY-MM
        const filtered = month
          ? entries.filter(e => e.at.startsWith(month))
          : entries;
        let income = 0;
        let expense = 0;
        for (const e of filtered) {
          if (e.type === 'income') income += e.amount;
          else expense += e.amount;
        }
        const scope = month ? `bulan ${month}` : 'semua waktu';
        return {
          type: 'text',
          summary: [
            `Ringkasan keuangan (${scope}):`,
            `Pemasukan: Rp ${income.toLocaleString('id-ID')}`,
            `Pengeluaran: Rp ${expense.toLocaleString('id-ID')}`,
            `Saldo: Rp ${(income - expense).toLocaleString('id-ID')}`,
            `Jumlah catatan: ${filtered.length}`,
          ].join('\n'),
        };
      }

      if (action === 'list') {
        const entries = await loadEntries();
        const last = entries.slice(-20).reverse();
        if (!last.length) {
          return {type: 'text', summary: 'Belum ada catatan keuangan.'};
        }
        const lines = last.map(
          e =>
            `${e.at.slice(0, 10)} · ${e.type === 'income' ? '+' : '-'}Rp ${e.amount.toLocaleString('id-ID')}${e.note ? ` · ${e.note}` : ''}`,
        );
        return {type: 'text', summary: lines.join('\n')};
      }

      return {
        type: 'error',
        summary: 'finance: action harus add | summary | list',
        errorMessage: 'unknown action',
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return {
        type: 'error',
        summary: `finance: ${errMsg}`,
        errorMessage: errMsg,
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'finance',
        description:
          'Catat dan ringkas keuangan lokal (Rupiah) di perangkat. action=add untuk mencatat, summary untuk total, list untuk 20 terakhir. Offline.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['add', 'summary', 'list'],
              description: 'add | summary | list',
            },
            amount: {type: 'number', description: 'Nominal Rupiah'},
            type: {
              type: 'string',
              enum: ['expense', 'income'],
              description: 'Default expense',
            },
            note: {type: 'string', description: 'Keterangan, mis. bensin'},
            month: {
              type: 'string',
              description: 'Filter summary YYYY-MM, opsional',
            },
          },
          required: ['action'],
        },
      },
    };
  }
}
