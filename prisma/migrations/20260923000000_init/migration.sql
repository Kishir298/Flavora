-- CreateTable
CREATE TABLE "user_profile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "allergies" TEXT NOT NULL DEFAULT '[]',
    "avoid_foods" TEXT NOT NULL DEFAULT '[]',
    "favorite_cuisines" TEXT NOT NULL DEFAULT '[]',
    "spice_preference" TEXT NOT NULL DEFAULT 'medium',
    "skill_level" TEXT NOT NULL DEFAULT 'beginner',
    "nutrition_goals" TEXT NOT NULL DEFAULT '{}',
    "preferred_cook_time_minutes" INTEGER NOT NULL DEFAULT 30,
    "theme" TEXT NOT NULL DEFAULT 'light',
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "cuisine" TEXT NOT NULL DEFAULT '',
    "cook_time_minutes" INTEGER NOT NULL DEFAULT 30,
    "difficulty" TEXT NOT NULL DEFAULT 'easy',
    "spice_level" TEXT NOT NULL DEFAULT 'mild',
    "diet_tags" TEXT NOT NULL DEFAULT '[]',
    "ingredients" TEXT NOT NULL DEFAULT '[]',
    "instructions" TEXT NOT NULL DEFAULT '[]',
    "nutrition" TEXT NOT NULL DEFAULT '{}',
    "cost_tier" TEXT NOT NULL DEFAULT 'low',
    "storage_tips" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "ingredient_substitutes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ingredient_name" TEXT NOT NULL,
    "substitute_name" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "interactions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL DEFAULT 'local',
    "recipe_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "rating" INTEGER,
    "features" TEXT NOT NULL DEFAULT '{}',
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "recommendation_weights" (
    "user_id" TEXT NOT NULL DEFAULT 'local',
    "feature_name" TEXT NOT NULL,
    "weight_value" REAL NOT NULL,
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("user_id", "feature_name")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL DEFAULT 'local',
    "name" TEXT NOT NULL,
    "quantity" REAL,
    "unit" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "purchase_date" DATETIME,
    "expiry_date" DATETIME,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "meal_plan_slots" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL DEFAULT 'local',
    "day" TEXT NOT NULL,
    "date" TEXT NOT NULL DEFAULT '',
    "meal" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "servings" INTEGER NOT NULL DEFAULT 1,
    "applied_subs" TEXT NOT NULL DEFAULT '[]'
);

-- CreateTable
CREATE TABLE "grocery_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL DEFAULT 'local',
    "name" TEXT NOT NULL,
    "quantity" REAL,
    "unit" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'other',
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "recipe_ids" TEXT NOT NULL DEFAULT '[]',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "applied_substitutions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL DEFAULT 'local',
    "recipe_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "replacement_name" TEXT NOT NULL,
    "quantity" REAL,
    "unit" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "interactions_recipe_id_idx" ON "interactions"("recipe_id");

-- CreateIndex
CREATE INDEX "interactions_action_idx" ON "interactions"("action");

-- CreateIndex
CREATE INDEX "inventory_items_user_id_category_idx" ON "inventory_items"("user_id", "category");

-- CreateIndex
CREATE INDEX "inventory_items_expiry_date_idx" ON "inventory_items"("expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_user_id_name_key" ON "inventory_items"("user_id", "name");

-- CreateIndex
CREATE INDEX "meal_plan_slots_user_id_date_idx" ON "meal_plan_slots"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "meal_plan_slots_user_id_day_meal_key" ON "meal_plan_slots"("user_id", "day", "meal");

-- CreateIndex
CREATE INDEX "grocery_items_user_id_checked_removed_idx" ON "grocery_items"("user_id", "checked", "removed");

-- CreateIndex
CREATE UNIQUE INDEX "grocery_items_user_id_name_note_key" ON "grocery_items"("user_id", "name", "note");

-- CreateIndex
CREATE INDEX "applied_substitutions_user_id_recipe_id_idx" ON "applied_substitutions"("user_id", "recipe_id");

-- CreateIndex
CREATE UNIQUE INDEX "applied_substitutions_user_id_recipe_id_original_name_key" ON "applied_substitutions"("user_id", "recipe_id", "original_name");

