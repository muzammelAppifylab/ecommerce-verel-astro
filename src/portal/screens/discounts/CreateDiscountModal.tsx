import {useNavigate} from '@tanstack/react-router';

import {DISCOUNT_PRESETS, type DiscountPreset} from '../../queries/discounts';
import {Icon, type IconName, Modal} from '../../ui';
import {PRESET_INFO} from './helpers';

/** `gift` is not in the kit's icon set yet (Request R3): `shopping-bag` stands in. */
const ICON: Record<DiscountPreset, IconName> = {
  order: 'percent',
  products: 'tag',
  bxgy: 'shopping-bag',
  shipping: 'truck',
};

/** "Create discount": pick the kind of offer, then open the editor preset for it (VAREL `CreateDiscountDialog`). */
export function CreateDiscountModal({open, onClose}: {open: boolean; onClose: () => void}) {
  const navigate = useNavigate();
  return (
    <Modal open={open} onClose={onClose} title="Create discount" description="Choose the kind of offer. You can make it a code or automatic next." size="sm">
      <ul className="preset-list">
        {DISCOUNT_PRESETS.map(p => (
          <li key={p}>
            <button
              type="button"
              className="preset-option"
              data-preset={p}
              onClick={() => {
                onClose();
                void navigate({to: '/discounts/new', search: {type: p}});
              }}>
              <span className="preset-icon">
                <Icon name={ICON[p]} size={16} />
              </span>
              <span className="preset-text">
                <span className="preset-title">{PRESET_INFO[p].title}</span>
                <span className="preset-detail">{PRESET_INFO[p].detail}</span>
              </span>
              <Icon name="chevron-right" size={16} className="preset-chevron" />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
