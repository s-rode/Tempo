import { Check, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { JSX, useState } from 'react'
import { defaultComparableCategories, type ComparableCategory } from 'shared/categories'
import { Category } from 'shared/dist/types.js'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../utils/trpc'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'
import { Textarea } from '../ui/textarea'
import { SettingsPlaceholder, SettingsSection } from './SettingsLayout'

function checkCategoriesAgainstDefaults(
  current: Category[] | undefined,
  defaults: ComparableCategory[]
): boolean {
  return Boolean(
    current &&
      current.length === defaults.length &&
      defaults.every((expected) => {
        const actual = current.find((category) => category.name === expected.name)
        return (
          actual &&
          (actual.description || '') === (expected.description || '') &&
          actual.isProductive === expected.isProductive
        )
      })
  )
}

export const notionStyleCategoryColors = [
  '#3B82F6', // Blue - defualt productive
  '#EC4899', // Pink - default unproductive
  '#A855F7', // Purple
  '#F97316', // Orange
  '#CA8A04', // Gold
  '#10B981', // Green
  '#06B6D4', // Cyan
  '#6B7280', // Gray
  '#8B5CF6', // Violet
  '#D946EF', // Fuchsia
  '#F59E0B', // Amber
  '#22C55E' // Lime
]

type CategoryDraft = Omit<Category, '_id' | 'userId' | 'createdAt' | 'updatedAt'>

interface CategoryFormProps {
  initialData?: Category
  onSave: (data: CategoryDraft) => void
  onCancel: () => void
  isSaving: boolean
}

function CategoryForm({ initialData, onSave, onCancel, isSaving }: CategoryFormProps): JSX.Element {
  const [name, setName] = useState(initialData?.name || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [color, setColor] = useState(
    initialData?.color ||
      notionStyleCategoryColors[Math.floor(Math.random() * notionStyleCategoryColors.length)]
  )
  const [isProductive, setIsProductive] = useState(initialData?.isProductive ?? true)
  const [error, setError] = useState('')

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setError('Enter a name.')
      return
    }
    setError('')
    onSave({ name: name.trim(), description, color, isProductive })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="tempo-pref-form"
      onKeyDown={(event) => event.key === 'Escape' && onCancel()}
    >
      <div className="tempo-pref-form-grid">
        <label htmlFor="categoryName">Name</label>
        <Input
          autoFocus
          id="categoryName"
          placeholder="For example, Deep work"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="tempo-pref-input"
          required
        />
        <label htmlFor="categoryDescription">Description</label>
        <Textarea
          rows={2}
          id="categoryDescription"
          placeholder="What belongs in this category"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="tempo-pref-input resize-none"
        />
        <span>Color</span>
        <div className="tempo-pref-swatches" role="radiogroup" aria-label="Category color">
          {notionStyleCategoryColors.map((swatch) => (
            <button
              type="button"
              key={swatch}
              role="radio"
              aria-checked={color === swatch}
              aria-label={swatch}
              className="tempo-pref-swatch"
              style={{ backgroundColor: swatch }}
              onClick={() => setColor(swatch)}
            >
              {color === swatch && <Check size={11} strokeWidth={3} aria-hidden="true" />}
            </button>
          ))}
        </div>
        <label htmlFor="isProductive">Productive</label>
        <div>
          <Switch
            id="isProductive"
            size="sm"
            checked={isProductive}
            onCheckedChange={setIsProductive}
          />
        </div>
      </div>
      <div className="tempo-pref-form-actions">
        {error && (
          <p role="alert" className="mr-auto text-xs text-destructive">
            {error}
          </p>
        )}
        <Button type="button" variant="glass" size="compact" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" size="compact" disabled={isSaving}>
          {isSaving && <Loader2 className="animate-spin" aria-hidden="true" />}
          {initialData ? 'Save' : 'Add category'}
        </Button>
      </div>
    </form>
  )
}

export function CategoryManagement(): JSX.Element {
  const { token } = useAuth()
  const utils = trpc.useUtils()
  const query = trpc.category.getCategories.useQuery(
    { token: token || '' },
    { enabled: Boolean(token) }
  )
  const categories = (query.data || []) as Category[]
  const [form, setForm] = useState<Category | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = () => {
    void utils.category.getCategories.invalidate()
    setForm(null)
    setError(null)
  }
  const failed = (failure: { message: string }) => setError(failure.message)
  const create = trpc.category.createCategory.useMutation({ onSuccess: refresh, onError: failed })
  const update = trpc.category.updateCategory.useMutation({ onSuccess: refresh, onError: failed })
  const remove = trpc.category.deleteCategory.useMutation({ onSuccess: refresh, onError: failed })
  const reset = trpc.category.resetToDefault.useMutation({ onSuccess: refresh, onError: failed })
  const busy = create.isLoading || update.isLoading || remove.isLoading || reset.isLoading
  const defaults = checkCategoriesAgainstDefaults(
    query.data as Category[] | undefined,
    defaultComparableCategories
  )
  const save = async (data: CategoryDraft) => {
    if (!token || form === null) return
    if (form === 'new') await create.mutateAsync({ token, ...data })
    else await update.mutateAsync({ token, id: form._id, ...data })
  }

  return (
    <SettingsSection
      title="Categories"
      description="Organize activities and choose which ones count as productive."
      actions={
        <Button
          variant="glass"
          size="compact"
          disabled={!token || busy || form !== null}
          onClick={() => setForm('new')}
        >
          <Plus aria-hidden="true" />
          Add
        </Button>
      }
      footer={
        (error || query.error || (!defaults && !query.isLoading)) && (
          <>
            {(error || query.error) && (
              <p role="alert" className="text-destructive">
                {error || query.error?.message}
              </p>
            )}
            {!defaults && !query.isLoading && (
              <button
                type="button"
                className="tempo-pref-link"
                disabled={busy || !token}
                onClick={() => {
                  if (
                    token &&
                    window.confirm('Replace all categories with the default categories?')
                  )
                    reset.mutate({ token })
                }}
              >
                Restore default categories…
              </button>
            )}
          </>
        )
      }
    >
      {form === 'new' && (
        <CategoryForm onCancel={() => setForm(null)} isSaving={busy} onSave={save} />
      )}
      {query.isLoading && <SettingsPlaceholder>Loading categories…</SettingsPlaceholder>}
      {!query.isLoading && categories.length === 0 && form === null && (
        <SettingsPlaceholder>No categories yet.</SettingsPlaceholder>
      )}
      {categories.map((category) =>
        form !== null && form !== 'new' && form._id === category._id ? (
          <CategoryForm
            key={category._id}
            initialData={category}
            onCancel={() => setForm(null)}
            isSaving={busy}
            onSave={save}
          />
        ) : (
          <div key={category._id} className="tempo-pref-row tempo-pref-list-row">
            <div className="tempo-pref-row-main">
              <span
                aria-hidden="true"
                className="tempo-pref-dot"
                style={{ backgroundColor: category.color }}
              />
              <div className="tempo-pref-row-text">
                <div className="tempo-pref-title truncate">{category.name}</div>
                {category.description && (
                  <div className="tempo-pref-description truncate">{category.description}</div>
                )}
              </div>
              <div className="tempo-pref-control">
                <label
                  htmlFor={`category-productive-${category._id}`}
                  className="tempo-pref-inline-label"
                >
                  Productive
                </label>
                <Switch
                  id={`category-productive-${category._id}`}
                  size="sm"
                  checked={category.isProductive}
                  disabled={busy || !token}
                  aria-label={`Count ${category.name} as productive`}
                  onCheckedChange={(next) =>
                    token && update.mutate({ token, id: category._id, isProductive: next })
                  }
                />
                <Button
                  size="compact"
                  variant="ghost"
                  className="tempo-pref-icon-button"
                  disabled={busy || form !== null}
                  aria-label={`Edit ${category.name}`}
                  title="Edit"
                  onClick={() => setForm(category)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  size="compact"
                  variant="ghost"
                  className="tempo-pref-icon-button tempo-pref-danger"
                  disabled={busy || !token}
                  aria-label={`Delete ${category.name}`}
                  title="Delete"
                  onClick={() => {
                    if (token && window.confirm(`Delete category “${category.name}”?`))
                      remove.mutate({ token, id: category._id })
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>
        )
      )}
    </SettingsSection>
  )
}
