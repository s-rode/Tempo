import {
  Check,
  Edit3,
  FolderPlus,
  Loader2,
  PlusCircle,
  ToggleLeft,
  ToggleRight,
  Trash2
} from 'lucide-react'
import { JSX, useEffect, useState } from 'react'
import { defaultComparableCategories, type ComparableCategory } from 'shared/categories'
import { Category } from 'shared/dist/types.js'
import { useAuth } from '../../contexts/AuthContext' // Added useAuth import
import { trpc } from '../../utils/trpc'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card' // Added Card components
import { Input } from '../ui/input' // Added shadcn/ui Input
import { Label } from '../ui/label' // Added shadcn/ui Label
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover' // Added Popover imports
import { Switch } from '../ui/switch' // Added shadcn/ui Switch
import { Textarea } from '../ui/textarea'

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

interface CategoryColorPickerProps {
  selectedColor: string
  onColorChange: (color: string) => void
}

function CategoryColorPicker({
  selectedColor,
  onColorChange
}: CategoryColorPickerProps): JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-10 h-10 p-0 border-border hover:border-ring flex-shrink-0"
          style={{ backgroundColor: selectedColor, transition: 'background-color 0.2s' }}
          aria-label="Pick a color"
          title={selectedColor}
        ></Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 bg-popover border-border">
        <div className="grid grid-cols-6 gap-2 p-3 rounded-md">
          {notionStyleCategoryColors.map((bgColor) => (
            <button
              type="button"
              key={bgColor}
              className={`w-8 h-8 rounded-full flex items-center justify-center focus:outline-none ring-1 ring-border hover:ring-2 hover:ring-ring transition-all`}
              style={{ backgroundColor: bgColor }}
              onClick={() => {
                onColorChange(bgColor)
              }}
              title={bgColor}
            >
              {selectedColor === bgColor && <Check size={18} className="text-white" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Basic Form for Create/Edit
interface CategoryFormProps {
  initialData?: Category
  onSave: (data: Omit<Category, '_id' | 'userId' | 'createdAt' | 'updatedAt'>) => void
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
  const [isProductive, setIsProductive] = useState(
    initialData?.isProductive === undefined ? true : initialData.isProductive
  )
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setError('')
    onSave({ name, description, color, isProductive })
  }

  return (
    <form onSubmit={handleSubmit} className="p-6 bg-card rounded-lg shadow-md space-y-6">
      <div>
        <Label htmlFor="categoryName" className="block text-sm font-medium text-foreground mb-1">
          Name <span className="text-red-500">*</span>
        </Label>
        <Input
          placeholder="Enter category name"
          id="categoryName"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground focus:ring-primary focus:border-primary"
          required
        />
      </div>
      <div>
        <Label
          htmlFor="categoryDescription"
          className="block text-sm font-medium text-foreground mb-1"
        >
          Description
        </Label>
        <Textarea
          rows={2}
          placeholder="Enter category description"
          id="categoryDescription"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground focus:ring-primary focus:border-primary resize-none"
        />
      </div>

      {/* Container for Type and Color, arranged side-by-side on medium screens and up */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="flex items-center space-x-2 mt-1">
          <Switch id="isProductive" checked={isProductive} onCheckedChange={setIsProductive} />
          <Label htmlFor="isProductive" className="text-foreground text-sm font-medium">
            {isProductive ? 'Productive' : 'Unproductive'}
          </Label>
        </div>

        <div>
          <div className="flex items-start space-x-2 mt-1">
            <CategoryColorPicker selectedColor={color} onColorChange={setColor} />
            <span className="text-red-500">*</span>
          </div>
        </div>

        {error && <p className="text-sm text-destructive-foreground">{error}</p>}
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving} className="flex items-center">
          {isSaving ? (
            <>
              <Loader2 className="animate-spin -ml-1 mr-3 h-5 w-5 text-primary-foreground" />
              Saving...
            </>
          ) : (
            'Save Category'
          )}
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
  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Manage Categories</CardTitle>
            <CardDescription>
              Organize activities and choose which categories count as productive.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!token || busy || form !== null}
            onClick={() => setForm('new')}
          >
            <PlusCircle size={16} className="mr-2" />
            Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {(error || query.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error || query.error?.message}
          </p>
        )}
        {query.isLoading && <p className="text-sm text-muted-foreground">Loading categories…</p>}
        {form !== null ? (
          <CategoryForm
            initialData={form === 'new' ? undefined : form}
            onCancel={() => setForm(null)}
            isSaving={busy}
            onSave={async (data) => {
              if (!token) return
              if (form === 'new') await create.mutateAsync({ token, ...data })
              else await update.mutateAsync({ token, id: form._id, ...data })
            }}
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {categories.map((category) => (
              <li key={category._id} className="flex items-center gap-3 p-3">
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: category.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{category.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{category.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || !token}
                  aria-label={`${category.name}: ${category.isProductive ? 'productive' : 'distracting'}. Toggle productivity`}
                  onClick={() =>
                    token &&
                    update.mutate({ token, id: category._id, isProductive: !category.isProductive })
                  }
                >
                  {category.isProductive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Edit ${category.name}`}
                  onClick={() => setForm(category)}
                >
                  <Edit3 size={15} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || !token}
                  aria-label={`Delete ${category.name}`}
                  onClick={() => {
                    if (token && window.confirm(`Delete category “${category.name}”?`))
                      remove.mutate({ token, id: category._id })
                  }}
                >
                  <Trash2 size={15} />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {!query.isLoading && categories.length === 0 && form === null && (
          <p className="text-sm text-muted-foreground">No categories yet.</p>
        )}
        {!defaults && form === null && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !token}
            onClick={() => {
              if (token && window.confirm('Replace all categories with the default categories?'))
                reset.mutate({ token })
            }}
          >
            Reset to default
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
