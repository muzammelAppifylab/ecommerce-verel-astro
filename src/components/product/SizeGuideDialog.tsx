/* Port of VAREL src/pages/product/SizeGuideDialog.tsx. Rendered inside the BuyColumn island (no island of its own). */
import {Dialog} from '@/components/varel/Dialog';
import {useText} from '@/components/varel/text';

/* The prototype links "Size guide" to #size-guide without defining it; this is a minimal
   measurement table in the house voice so the link has a destination. */
const ROWS: [string, string, string, string][] = [
  ['XS', '82–86', '64–68', '88–92'],
  ['S', '86–90', '68–72', '92–96'],
  ['M', '90–96', '72–78', '96–102'],
  ['L', '96–102', '78–84', '102–108'],
  ['XL', '102–108', '84–90', '108–114'],
];

export function SizeGuideDialog({open, onClose, sizes}: {open: boolean; onClose: () => void; sizes: string[]}) {
  const rows = ROWS.filter(([s]) => sizes.includes(s));
  const t = useText('product');
  return (
    <Dialog open={open} onClose={onClose} title={t('sizeGuide.title')} description={t('sizeGuide.description')} width={520}>
      <div className="flex flex-col gap-6">
        <p className="text-body-sm text-text-secondary">{t('sizeGuide.body')}</p>
        {rows.length > 0 ? (
          <table className="w-full border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-strong text-left">
                {[t('sizeGuide.size'), t('sizeGuide.chest'), t('sizeGuide.waist'), t('sizeGuide.hip')].map(h => (
                  <th
                    key={h}
                    scope="col"
                    className="py-3 pr-4 font-sans text-label-sm font-normal tracking-label text-text-muted uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([s, ...cells]) => (
                <tr key={s} className="border-b border-hairline">
                  <th scope="row" className="py-3 pr-4 text-left font-normal">
                    {s}
                  </th>
                  {cells.map((c, i) => (
                    <td key={i} className="py-3 pr-4 text-text-secondary">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-body-sm text-text-secondary">{t('sizeGuide.fallback', {sizes: sizes.join(', ')})}</p>
        )}
      </div>
    </Dialog>
  );
}
