'use client';
// Cadastro/edição de mercadoria. Serve para vários mercados: os campos de identificação mudam
// conforme a categoria (IMEI para celular, placa/ano para veículo, série para máquina).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Plus, Trash2 } from 'lucide-react';
import { createItemFormAction, updateItemFormAction } from '@/app/actions/items';
import { createClient } from '@/lib/supabase/client';
import { COST_CATEGORIES, costCategoryLabel } from '@/lib/domain/views';
import { formatBRL, moneyInputValue, parseMoneyInput } from '@/lib/format';
import { toCents } from '@/lib/finance/money';
import { Alert, Row } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { MoneyField, SelectField, TextAreaField, TextField } from '@/components/ui/form';

const CATEGORIES = [
  { value: '', label: 'Escolha (opcional)' },
  { value: 'celular', label: 'Celular / eletrônico pequeno' },
  { value: 'moto', label: 'Moto' },
  { value: 'carro', label: 'Carro' },
  { value: 'eletronico', label: 'Eletrônico' },
  { value: 'peca', label: 'Peça' },
  { value: 'maquina', label: 'Máquina / ferramenta' },
  { value: 'outro', label: 'Outro' },
];

export interface ItemFormInitial {
  id?: string;
  name?: string;
  category?: string | null;
  brand?: string | null;
  model?: string | null;
  identifier?: string | null;
  imei?: string | null;
  serialNumber?: string | null;
  plate?: string | null;
  modelYear?: number | null;
  acquisitionCost?: number;
  targetSalePrice?: number | null;
  description?: string | null;
  photoPath?: string | null;
  photoUrl?: string | null;
  status?: string;
}

async function shrinkImage(file: File): Promise<Blob> {
  // Foto de celular chega com vários MB: reduz para até 1280px em JPEG antes de enviar
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}

export function ItemForm({ userId, initial = {}, returnTo }: { userId: string; initial?: ItemFormInitial; returnTo?: string }) {
  const router = useRouter();
  const editing = !!initial.id;
  const [form, setForm] = useState({
    name: initial.name ?? '',
    category: initial.category ?? '',
    brand: initial.brand ?? '',
    model: initial.model ?? '',
    identifier: initial.identifier ?? '',
    imei: initial.imei ?? '',
    serialNumber: initial.serialNumber ?? '',
    plate: initial.plate ?? '',
    modelYear: initial.modelYear ? String(initial.modelYear) : '',
    description: initial.description ?? '',
  });
  const [cost, setCost] = useState(moneyInputValue(initial.acquisitionCost));
  const [price, setPrice] = useState(moneyInputValue(initial.targetSalePrice ?? undefined));
  const [extraCosts, setExtraCosts] = useState<Array<{ key: number; category: string; amount: string }>>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(initial.photoUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const cat = form.category;
  const showImei = cat === 'celular';
  const showPlate = cat === 'moto' || cat === 'carro';
  const showSerial = cat === 'celular' || cat === 'eletronico' || cat === 'maquina' || cat === 'peca';
  const showAll = !cat || cat === 'outro';

  const acquisition = parseMoneyInput(cost);
  const parsedCosts = extraCosts.map((c) => ({ ...c, value: parseMoneyInput(c.amount) }));
  const totalCents = toCents(acquisition ?? 0) + parsedCosts.reduce((acc, c) => acc + toCents(c.value ?? 0), 0);

  /** Caminho da foto enviada; undefined = sem foto nova; null = envio falhou (item salva sem ela). */
  const uploadPhoto = async (): Promise<string | null | undefined> => {
    if (!photo) return undefined;
    try {
      const blob = await shrinkImage(photo);
      const path = `${userId}/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await createClient().storage.from('item-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      return uploadError ? null : path;
    } catch {
      return null;
    }
  };

  const submit = async () => {
    setError(null);
    setWarning(null);
    if (acquisition === null) {
      setError('Informe o valor de compra.');
      return;
    }
    const salePrice = price.trim() ? parseMoneyInput(price) : null;
    if (price.trim() && salePrice === null) {
      setError('Preço de venda inválido.');
      return;
    }
    const badCost = parsedCosts.find((c) => c.value === null || c.value <= 0);
    if (badCost) {
      setError('Preencha o valor de cada custo adicional (ou remova a linha).');
      return;
    }
    const year = form.modelYear.trim() ? Number(form.modelYear) : null;

    setSaving(true);
    const uploaded = await uploadPhoto();
    const input = {
      ...form,
      modelYear: year,
      acquisitionCost: acquisition,
      targetSalePrice: salePrice,
      photoPath: uploaded === undefined ? initial.photoPath ?? null : uploaded ?? initial.photoPath ?? null,
    };

    let itemId: string;
    let costsSaved = true;
    if (editing) {
      const res = await updateItemFormAction(initial.id!, input);
      setSaving(false);
      if (!res.ok) return setError(res.error);
      itemId = initial.id!;
    } else {
      const res = await createItemFormAction(input, parsedCosts.map((c) => ({ category: c.category, amount: c.value! })));
      setSaving(false);
      if (!res.ok) return setError(res.error);
      itemId = res.itemId;
      costsSaved = res.costsSaved;
    }
    const warnings: string[] = [];
    if (photo && uploaded === null) warnings.push('Não consegui enviar a foto; a mercadoria foi salva sem ela.');
    if (!costsSaved) warnings.push('Os custos adicionais não foram gravados; adicione de novo na tela da mercadoria.');
    if (warnings.length > 0) {
      setWarning(warnings.join(' '));
      setSavedId(itemId);
      return;
    }
    if (returnTo) router.push(`${returnTo}${returnTo.includes('?') ? '&' : '?'}item=${itemId}`);
    else router.push(`/app/estoque/${itemId}`);
    router.refresh();
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <TextField label="Nome / descrição" required value={form.name} onChange={set('name')} placeholder="iPhone 13 128GB Preto" autoComplete="off" autoFocus={!editing} />
      <SelectField label="Categoria" value={form.category} onChange={set('category')} options={CATEGORIES} />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Marca" value={form.brand} onChange={set('brand')} autoComplete="off" placeholder={showPlate ? 'Honda' : 'Apple'} />
        <TextField label="Modelo" value={form.model} onChange={set('model')} autoComplete="off" placeholder={showPlate ? 'XRE 300' : '13'} />
        {showImei || showAll ? <TextField label="IMEI" inputMode="numeric" value={form.imei} onChange={set('imei')} autoComplete="off" hint="15 dígitos (*#06#)" /> : null}
        {showSerial || showAll ? <TextField label="Número de série" value={form.serialNumber} onChange={set('serialNumber')} autoComplete="off" /> : null}
        {showPlate || showAll ? <TextField label="Placa" value={form.plate} onChange={set('plate')} autoComplete="off" placeholder="ABC1D23" /> : null}
        {showPlate || showAll ? <TextField label="Ano" inputMode="numeric" value={form.modelYear} onChange={set('modelYear')} autoComplete="off" placeholder="2022" /> : null}
        <TextField label="Identificação" value={form.identifier} onChange={set('identifier')} autoComplete="off" hint="Chassi, cor, código… o que ajudar a achar" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyField label="Valor de compra" required value={cost} onChange={setCost} />
        <MoneyField label="Preço de venda sugerido" value={price} onChange={setPrice} hint="Opcional" />
      </div>

      {!editing ? (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/3 p-4">
          <p className="text-base font-semibold text-white">Custos adicionais</p>
          {extraCosts.map((c, idx) => (
            <div key={c.key} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <SelectField
                label={`Tipo ${idx + 1}`}
                value={c.category}
                onChange={(e) => setExtraCosts((list) => list.map((x) => (x.key === c.key ? { ...x, category: e.target.value } : x)))}
                options={COST_CATEGORIES}
              />
              <MoneyField label="Valor" value={c.amount} onChange={(v) => setExtraCosts((list) => list.map((x) => (x.key === c.key ? { ...x, amount: v } : x)))} />
              <Button variant="ghost" aria-label={`Remover custo ${idx + 1}`} onClick={() => setExtraCosts((list) => list.filter((x) => x.key !== c.key))}>
                <Trash2 className="h-5 w-5" aria-hidden />
              </Button>
            </div>
          ))}
          <Button variant="secondary" className="w-full" onClick={() => setExtraCosts((list) => [...list, { key: Date.now(), category: 'reparo', amount: '' }])}>
            <Plus className="h-5 w-5" aria-hidden /> Adicionar custo
          </Button>
          <div className="border-t border-white/10 pt-2">
            <Row label="Compra" value={formatBRL(acquisition ?? 0)} />
            {parsedCosts.map((c) => (
              <Row key={c.key} label={costCategoryLabel(c.category)} value={formatBRL(c.value ?? 0)} />
            ))}
            <Row label="Custo total" value={formatBRL(totalCents / 100)} strong tone="sky" />
          </div>
        </div>
      ) : null}

      <TextAreaField label="Observações" value={form.description} onChange={set('description')} hint="Estado, acessórios, defeitos…" />

      <div className="space-y-2">
        <span className="block text-sm font-medium text-slate-300">Foto</span>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- foto local/assinada, sem otimização de imagem
          <img src={preview} alt="Foto da mercadoria" className="h-40 w-40 rounded-2xl border border-white/10 object-cover" />
        ) : null}
        <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-2xl border border-white/10 bg-white/6 px-5 text-base font-semibold text-slate-100 hover:bg-white/10 focus-within:outline-2 focus-within:outline-emerald-400">
          <Camera className="h-5 w-5" aria-hidden />
          {preview ? 'Trocar foto' : 'Adicionar foto'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setPhoto(file);
              setPreview(file ? URL.createObjectURL(file) : initial.photoUrl ?? null);
            }}
          />
        </label>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {warning ? (
        <Alert tone="warning">
          {warning}
          {savedId ? (
            <a href={`/app/estoque/${savedId}`} className="mt-2 block font-semibold text-white underline underline-offset-4">
              Ver mercadoria
            </a>
          ) : null}
        </Alert>
      ) : null}

      <Button type="submit" size="lg" className="w-full" loading={saving} disabled={!form.name.trim() || !!savedId}>
        {editing ? 'Salvar alterações' : 'Salvar mercadoria'}
      </Button>
    </form>
  );
}
