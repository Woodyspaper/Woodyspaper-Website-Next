import { AccountPrompt } from './AccountPrompt'
import { LightSpeedStore } from './LightSpeedStore'
import { Reveal } from './Reveal'

type InventorySectionProps = {
  /** Opens this search in the storefront after the hub page loads. */
  initialQuery?: string
  /** Opens the store's account page (sign-in form when signed out). */
  openAccount?: boolean
  /** Front-window mode: clicks, searches and sign-in open on this page instead. */
  hubPath?: string
}

export function InventorySection({ initialQuery = '', openAccount = false, hubPath }: InventorySectionProps) {
  return (
    <Reveal as="section" id="products" className="scroll-mt-chrome px-4 py-12 sm:py-20 lg:scroll-mt-chrome-lg">
      <div className="mx-auto max-w-7xl">
        <div className="mb-10 text-center sm:mb-16">
          <h2 className="mb-4 text-3xl font-bold text-slate-900 sm:text-4xl">Inventory</h2>
          <div className="mx-auto h-1.5 w-12 rounded-full bg-brand-blue sm:w-20" />
          <AccountPrompt />
        </div>

        {/*
          Store layout lives here. Remove any line to fall back to the setting
          in Lightspeed admin → Design. Options are typed — hover a key for
          its allowed values. Columns per row come from card size in admin.
        */}
        <LightSpeedStore
          productsPerPage={30}
          initialQuery={initialQuery}
          openAccount={openAccount}
          hubPath={hubPath}
          defaultCategoryId={0}
          design={{
            productListCardSpacingType: 'wide', // Ecwid's default; 'medium' | 'narrow' fit more per row
            product_list_category_title_behavior: 'SHOW_BELOW_IMAGE', // title on the card, styled in index.css
          }}
        />
      </div>
    </Reveal>
  )
}
