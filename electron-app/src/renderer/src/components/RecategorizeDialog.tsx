import React, { useEffect, useState } from 'react'
import { Category } from 'shared'
import type { ActivityToRecategorize } from '../App'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { useAuth } from '../contexts/AuthContext'
import { trpc } from '../utils/trpc'

interface RecategorizeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activityTarget: ActivityToRecategorize | null
  allCategories: Category[]
  onSave: (
    newCategoryId: string,
    options?: { learningGoalRef?: string; learnFromCorrection?: boolean }
  ) => void
  isLoading: boolean
}

const RecategorizeDialog: React.FC<RecategorizeDialogProps> = ({
  open,
  onOpenChange,
  activityTarget,
  allCategories,
  onSave,
  isLoading
}) => {
  const { token } = useAuth()
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectedGoalRef, setSelectedGoalRef] = useState<string | null>(null)
  const [step, setStep] = useState<'category' | 'goal'>('category')
  const learningTargets = trpc.activeWindowEvents.getCorrectionLearningTargets.useQuery(
    { token: token || '', eventIds: activityTarget?.eventIds || [] },
    { enabled: Boolean(open && token && activityTarget?.eventIds.length) }
  )

  useEffect(() => {
    if (!open) return
    setSelectedCategoryId(null)
    setSelectedGoalRef(null)
    setStep('category')
  }, [open, activityTarget?.eventIds.join(':')])

  if (!activityTarget) {
    return null
  }

  const handleCategorySelectAndSave = (category: Category) => {
    if (isLoading) return
    const currentCategory = allCategories.find(
      (item) => item._id === activityTarget.currentCategoryId
    )
    const changesPolarity =
      !currentCategory || currentCategory.isProductive !== category.isProductive
    const learning = learningTargets.data
    if (changesPolarity && learning?.eligible && learning.requiresGoalSelection) {
      setSelectedCategoryId(category._id)
      setSelectedGoalRef(learning.targets[0]?.ref || null)
      setStep('goal')
      return
    }
    onSave(category._id, {
      learningGoalRef: changesPolarity ? learning?.automaticGoalRef || undefined : undefined,
      learnFromCorrection: changesPolarity
    })
  }

  const availableCategories = allCategories.filter(
    (cat) => cat._id !== activityTarget.currentCategoryId
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {activityTarget.currentCategoryId === 'uncategorized'
              ? 'Classify activity'
              : 'Re-categorize Activity'}
          </DialogTitle>
          <DialogDescription className="flex flex-col gap-2">
            <div>
              Change the category for <strong>{activityTarget.nameToDisplay}</strong>
            </div>
            <div>
              Currently categorized as <strong>{activityTarget.currentCategoryName}</strong>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <h4 className="mb-3 text-sm font-medium text-muted-foreground">Move to Category:</h4>
          {availableCategories.length > 0 ? (
            <div className="flex flex-wrap items-start gap-2">
              {availableCategories.map((cat) => (
                <Button
                  key={cat._id}
                  variant={'outline'}
                  onClick={() => handleCategorySelectAndSave(cat)}
                  disabled={
                    isLoading || (activityTarget.eventIds.length > 0 && learningTargets.isLoading)
                  }
                  size="sm"
                  style={{
                    borderColor: cat.color
                  }}
                  className={`hover:bg-[${cat.color}]/10`}
                >
                  {cat.name}
                  {activityTarget.currentCategoryId === 'uncategorized'
                    ? cat.isProductive
                      ? ' · Productive'
                      : ' · Distracting'
                    : ''}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No other categories available to move to.
            </p>
          )}
        </div>

        {step === 'goal' && selectedCategoryId && (
          <div className="border-t pt-4" role="group" aria-label="Learning goal">
            <h4 className="text-sm font-medium">Which goal was this related to?</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Tempo will use this correction only for similar work with this tool.
            </p>
            <div className="mt-3 space-y-1 rounded-md border p-1">
              {learningTargets.data?.targets.map((target) => (
                <button
                  key={target.ref}
                  type="button"
                  onClick={() => setSelectedGoalRef(target.ref)}
                  className={`flex w-full items-center rounded px-2.5 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selectedGoalRef === target.ref
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/60'
                  }`}
                  aria-pressed={selectedGoalRef === target.ref}
                >
                  {target.text}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep('category')}
                disabled={isLoading}
              >
                Back
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSave(selectedCategoryId, { learnFromCorrection: false })}
                  disabled={isLoading}
                >
                  Change only
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    onSave(selectedCategoryId, {
                      learningGoalRef: selectedGoalRef || undefined,
                      learnFromCorrection: true
                    })
                  }
                  disabled={isLoading || !selectedGoalRef}
                >
                  Save correction
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default RecategorizeDialog
