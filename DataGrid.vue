<template>
  <!-- 拖拽选中时禁止文本选择 -->
  <div class="app-container" :class="{ 'no-text-select': dragSelecting }">
    <h1>{{ title }}</h1>

    <!-- ========== 功能按钮条 ========== -->
    <div class="filter-container">
      <div class="filter-buttons">
        <!-- 批量删除按钮 -->
        <button
          @click="batchDelete"
          :disabled="!selectedRowIds.length"
          class="batch-delete-button"
        >
          批量删除
        </button>
        <button @click="batchModify" class="batch-modify-button">批量修改</button>
        <button @click="addEmptyRow" class="add-empty-button">新增空行</button>
        <button @click="openEditFieldsModal" class="edit-fields-button">编辑字段</button>
        <button @click="applyFilters">确认筛选</button>
        <button @click="resetFilters">重置筛选</button>
        <button @click="downloadCsv">导出 CSV</button>

        <!-- ========== 填充颜色按钮 ========== -->
        <div class="color-fill-wrapper" ref="colorFillWrapperRef">
          <button class="color-fill-button" @click="toggleColorDropdown">
            <span class="color-preview" :style="{ background: currentFillColor }"></span>
            ▾
          </button>
          <div v-show="colorDropdownOpen" class="color-dropdown" @mousedown.stop>
            <div
              v-for="clr in paletteColors"
              :key="clr.name"
              class="color-swatch"
              :title="clr.name"
              :style="{ background: clr.value }"
              @click="applyFillColor(clr)"
            ></div>
          </div>
        </div>
        <!-- ========== 颜色按钮结束 ========== -->
      </div>

      <!-- ========== 表格区域 ========== -->
      <div
        v-if="records.length"
        class="table-container"
        ref="tableContainerRef"
        style="position:relative;"
      >
        <!-- “填充预览”虚线框 -->
        <div
          class="fill-preview-box"
          v-if="fillPreview.visible"
          :style="fillPreviewStyles"
        ></div>

        <table id="records-table">
          <!-- ======= thead: 3 行 ======= -->
          <!-- ① 列序号字母行 -->
          <thead>
            <tr class="column-letters">
              <!-- 选择列表头：不放任何控件 -->
              <th :style="colStyle(0)"></th>
              <th :style="colStyle(1)">No.</th>
              <th :style="colStyle(2)">拖拽</th>

              <th
                v-for="(field, idx) in fieldList"
                :key="'letter-'+idx"
                v-show="visibleColumns.includes(field)"
                :class="['column-'+letters[idx], { 'column-selected': isColumnFullySelected(field)}]"
                :style="colStyle(idx+baseOffset)"
                @click="onColumnLetterClick($event, idx, field)"
              >
                {{ letters[idx] }}
                <div class="resizer" @mousedown="initResize($event, idx+baseOffset)"></div>
              </th>

              <!-- 冻结列：操作/删除/复制 -->
              <th
                class="sticky-op"
                :style="colStyle(fieldList.length+baseOffset)"
              >
                操作
                <div
                  class="resizer"
                  @mousedown="initResize($event, fieldList.length+baseOffset)"
                ></div>
              </th>
              <th
                class="sticky-del"
                :style="colStyle(fieldList.length+baseOffset+1)"
              >
                删除
                <div
                  class="resizer"
                  @mousedown="initResize($event, fieldList.length+baseOffset+1)"
                ></div>
              </th>
              <th
                class="sticky-copy"
                :style="colStyle(fieldList.length+baseOffset+2)"
              >
                复制行
                <div
                  class="resizer"
                  @mousedown="initResize($event, fieldList.length+baseOffset+2)"
                ></div>
              </th>
            </tr>

            <!-- ② 字段名行 -->
            <tr class="column-titles">
              <th :style="colStyle(0)">选择</th>
              <th :style="colStyle(1)">No.</th>
              <th :style="colStyle(2)">&#9776;</th>

              <th
                v-for="(field, idx) in fieldList"
                :key="'title-'+field"
                v-show="visibleColumns.includes(field)"
                :style="colStyle(idx+baseOffset)"
                :class="['sortable', 'column-'+letters[idx]]"
                @click="handleSort(field)"
              >
                <span>{{ getAlias(field) }}</span>
                <span v-if="sortField === field" class="sort-indicator">
                  {{ sortOrder === 'asc' ? '▲' : '▼' }}
                </span>
                <div class="resizer" @mousedown="initResize($event, idx+baseOffset)"></div>
              </th>

              <th
                class="sticky-op"
                :style="colStyle(fieldList.length+baseOffset)"
              >
                操作
                <div
                  class="resizer"
                  @mousedown="initResize($event, fieldList.length+baseOffset)"
                ></div>
              </th>
              <th
                class="sticky-del"
                :style="colStyle(fieldList.length+baseOffset+1)"
              >
                删除
                <div
                  class="resizer"
                  @mousedown="initResize($event, fieldList.length+baseOffset+1)"
                ></div>
              </th>
              <th
                class="sticky-copy"
                :style="colStyle(fieldList.length+baseOffset+2)"
              >
                复制行
                <div
                  class="resizer"
                  @mousedown="initResize($event, fieldList.length+baseOffset+2)"
                ></div>
              </th>
            </tr>

            <!-- ③ 筛选行 -->
            <tr class="filter-row">
              <th :style="colStyle(0)"></th>
              <th :style="colStyle(1)"></th>
              <th :style="colStyle(2)"></th>
              <th
                v-for="(field, idx) in fieldList"
                :key="'filter-'+field"
                v-show="visibleColumns.includes(field)"
                :style="colStyle(idx+baseOffset)"
                :class="'column-'+letters[idx]"
              >
                <button class="exact-filter-btn" @click="openExactFilter(field, $event)">多选</button>
                <!-- 已选精确筛选标签 -->
                <div v-if="exactFilters[field]?.length" class="selected-tags">
                  <span
                    v-for="val in exactFilters[field]"
                    :key="val"
                    class="filter-chip"
                  >
                    {{ val }}
                    <span class="chip-remove" @click="removeExactFilterItem(field, val)">x</span>
                  </span>
                </div>
                <!-- 模糊筛选 -->
                <input
                  type="text"
                  class="column-filter-fuzzy"
                  v-model="fuzzyFilters[field]"
                  placeholder="模糊搜索"
                  @keypress.enter.prevent="applyFilters"
                />
              </th>
              <!-- 冻结列空白 -->
              <th class="sticky-op"  :style="colStyle(fieldList.length+baseOffset)"></th>
              <th class="sticky-del" :style="colStyle(fieldList.length+baseOffset+1)"></th>
              <th class="sticky-copy" :style="colStyle(fieldList.length+baseOffset+2)"></th>
            </tr>
          </thead>

          <!-- ======= tbody ======= -->
          <tbody ref="tbodyRef">
            <tr
              v-for="(rec, rowIdx) in sortedRecords"
              :key="rec.id"
              :data-id="rec.id"
              :style="{ backgroundColor: getRowColor(rec.ext10 || '白色') }"
              :class="{ 'highlight-flash': highlightedRows.includes(rec.id) }"
            >
              <!-- 选择框列（缩小尺寸） -->
              <td :style="colStyle(0)" class="checkbox-cell">
                <input
                  type="checkbox"
                  :value="rec.id"
                  v-model="selectedRowIds"
                />
              </td>

              <td :style="colStyle(1)" class="row-number">{{ rowIdx + 1 }}</td>
              <td :style="colStyle(2)" class="drag-handle">&#9776;</td>

              <!-- 数据单元格 -->
              <td
                v-for="(field, cIdx) in fieldList"
                :key="field+'-'+rec.id"
                v-show="visibleColumns.includes(field)"
                :class="['report-cell','column-'+letters[cIdx], { 'cell-selected': isCellSelected(rowIdx, field)}]"
                :style="[colStyle(cIdx+baseOffset), { backgroundColor: getCellFillColor(rec.id, field) }]"
                @mousedown="onCellMouseDown($event, field, rowIdx)"
                @click="onCellClick($event, field, rowIdx)"
                @dblclick="onCellDblClick($event, field, rowIdx)"
              >
                <!-- 根据字段是否只读选择控件 -->
                <template v-if="readOnlyFields.includes(field)">
                  <input type="text" v-model="rec[field]" readonly class="read-only" />
                </template>
                <template v-else-if="dateFields.includes(field)">
                  <input type="date" v-model="rec[field]" @change="markModified(rec.id)" />
                </template>
                <template v-else-if="numberFields.includes(field)">
                  <input type="number" v-model="rec[field]" @input="markModified(rec.id)" />
                </template>
                <template v-else>
                  <input type="text" v-model="rec[field]" @input="markModified(rec.id)" />
                </template>

                <!-- 填充手柄 -->
                <div class="fill-handle" @mousedown.stop.prevent="startFillDrag($event, rowIdx, field)"></div>
              </td>

              <!-- 操作/删除/复制 -->
              <td class="sticky-op">
                <button :disabled="!modifiedIds.includes(rec.id)" @click="openConfirmModal(rec.id)">修改</button>
              </td>
              <td class="sticky-del">
                <button @click="deleteRecord(rec.id)">删除</button>
              </td>
              <td class="sticky-copy">
                <button @click="copyRecord(rec.id)">复制行</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else style="margin-top:12px;">暂无数据</div>

      <!-- 统计栏 -->
      <div id="statistics-bar" style="margin-top:20px;font-weight:bold;">
        <span v-if="statsCount">{{ statsCount }}</span>
        <span v-if="statsSum"> | {{ statsSum }}</span>
        <span v-if="statsAvg"> | {{ statsAvg }}</span>
      </div>
    </div>

    <!-- ======= loading 动画 ======= -->
    <div v-if="loading" class="loading">
      <div class="loading-spinner"></div>
    </div>

    <!-- ======= 通知条 ======= -->
    <div id="notification" :class="notificationType" v-show="showNotification">
      {{ notificationMessage }}
    </div>

    <!-- ======= 修改确认弹窗 ======= -->
    <div v-if="showConfirmModal" class="modal">
      <div class="modal-content">
        <h2>确认修改？</h2>
        <p>您确定要更新此条记录吗？</p>
        <button id="confirm-btn" @click="confirmUpdateAction">确认</button>
        <button class="cancel-btn" @click="closeConfirmModal">取消</button>
      </div>
    </div>

    <!-- ======= 编辑字段弹窗 ======= -->
    <div v-if="showEditFieldsModal" class="modal">
      <div class="modal-content edit-fields-modal-content">
        <h2>编辑字段</h2>

        <!-- 列显示/隐藏复选框 -->
        <div style="margin-bottom:8px;">
          <label style="display:flex;align-items:center;">
            <input type="checkbox" :checked="isAllChecked" @change="toggleSelectAll($event)" /> 全选
          </label>
        </div>
        <div>
          <label
            v-for="(field, idx) in fieldList"
            :key="'check-'+field"
            style="display:flex;align-items:center;margin-bottom:8px;"
          >
            <input type="checkbox" v-model="visibleColumnsProxy" :value="field" />
            {{ letters[idx] }} – {{ getAlias(field) }}
          </label>
        </div>

        <hr />
        <h3>自定义扩展字段别名</h3>
        <!-- NEW: 10 个别名输入框，两列网格排版 -->
        <div class="alias-grid">
          <label v-for="n in 10" :key="'alias-'+n">
            {{ 'ext' + n }} ：
            <input type="text" v-model="aliasForm['ext'+n]" />
          </label>
        </div>

        <div style="margin-top:20px;">
          <button @click="saveFieldsAndAliases">保存设置</button>
          <button class="cancel-btn" @click="closeEditFieldsModal">取消</button>
        </div>
      </div>
    </div>

    <!-- ======= 多选精确筛选浮层 ======= -->
    <div
      v-if="exactFilterDropdownOpen"
      class="exact-filter-dropdown"
      :style="{ top: exactDropdownPosition.top+'px', left: exactDropdownPosition.left+'px', width: exactDropdownPosition.width+'px' }"
    >
      <div class="exact-filter-header"><b>请选择（{{ getAlias(currentExactField) }}）</b></div>
      <div class="exact-filter-body">
        <div
          v-for="opt in (uniqueValues[currentExactField] || [])"
          :key="opt"
          class="exact-filter-item"
        >
          <label><input type="checkbox" :value="opt" v-model="exactFilterTempValues" /> {{ opt }}</label>
        </div>
      </div>
      <div class="exact-filter-footer">
        <button @click="confirmExactFilter">确定</button>
        <button @click="cancelExactFilter">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDataGrid, type DataGridConfig } from '@/composables/useDataGrid'

const props = defineProps<{ title: string; config: DataGridConfig }>()

/* 全量接入 composable */
const grid = useDataGrid(props.config)

/* 把返回对象展开为顶层变量，这样模板里名字不变 */
const {
  records,sortedRecords,uniqueValues,aliasMap,
  exactFilters,fuzzyFilters,modifiedIds,
  loading,showNotification,notificationMessage,notificationType,
  fieldList,letters,visibleColumns,visibleColumnsProxy,sortField,sortOrder,
  columnWidths,page,limit,total,
  statsCount,statsSum,statsAvg,
  selectedCells,dragSelecting,tbodyRef,tableContainerRef,fillPreview,fillPreviewStyles,highlightedRows,
  showEditFieldsModal,aliasForm,showConfirmModal,
  exactFilterDropdownOpen,
  currentExactField,
  exactFilterTempValues,
  exactDropdownPosition,
  colStyle,initResize,applyFilters,resetFilters,handleSort,
  openConfirmModal,closeConfirmModal,confirmUpdateAction,batchModify,
  deleteRecord,copyRecord,downloadCsv,addEmptyRow,
  markModified,onCellClick,onCellDblClick,onCellMouseDown,isCellSelected,
  copySelectedCells,pasteClipboardData,
  startFillDrag,onFillMove,onFillEnd,
  onColumnLetterClick,isColumnFullySelected,
  openEditFieldsModal,closeEditFieldsModal,saveFieldsAndAliases,
  openExactFilter,confirmExactFilter,cancelExactFilter,removeExactFilterItem,
  getAlias,getRowColor,readOnlyFields,numberFields,dateFields,
  colorDropdownOpen,currentFillColor,paletteColors,
  toggleColorDropdown,applyFillColor,getCellFillColor,
  colorFillWrapperRef,
  selectedRowIds,batchDelete,
  baseOffset
} = grid
</script>

<!-- ① 全局样式：主题色变量（不加 scoped） -->
<style>
:root{
  --primary-color:#C82B24;
  --primary-hover:#a3221d;
  --primary-light:rgba(200,43,36,.30);
}
</style>

<!-- ② 组件局部样式（scoped） -->
<style scoped>
.app-container            { margin:20px;font-family:Arial,sans-serif;background:#f8f9fa;}
.app-container.no-text-select{user-select:none;}
h1                        {text-align:center;color:var(--primary-color);}
.filter-container         {background:#fff;border:1px solid #ddd;border-radius:8px;padding:15px 20px;margin-bottom:30px;box-shadow:0 2px 4px rgba(0,0,0,.1);}
.filter-buttons           {display:flex;justify-content:flex-end;gap:10px;margin-bottom:20px;}
.filter-buttons button    {background:var(--primary-color);color:#fff;border:none;border-radius:4px;padding:8px 16px;font-size:14px;cursor:pointer;transition:.3s;}
.filter-buttons button:hover:not(:disabled){background:var(--primary-hover);}
.table-container          {max-height:80vh;overflow:auto;border:1px solid #ddd;border-radius:8px;background:#fff;position:relative;}
table                     {border-collapse:collapse;width:100%;table-layout:fixed;}
th,td                     {padding:4px 6px;text-align:left;border:1px solid #ccc;position:relative;overflow:hidden;height:40px;box-sizing:border-box;}
thead tr.column-letters th{position:sticky;top:0;background:#e0e0e0;color:#333;font-weight:bold;z-index:4;}
thead tr.column-titles th {position:sticky;top:40px;background:var(--primary-color);color:#fff;cursor:pointer;user-select:none;z-index:3;}
thead tr.filter-row th    {position:sticky;top:80px;background:#fff;z-index:2;}
.sortable:hover           {background:var(--primary-hover);}
.sort-indicator           {position:absolute;right:10px;font-size:12px;}
.drag-handle              {cursor:move;}
.read-only                {background:#f0f0f0;font-style:italic;color:#666;}
table td input,table td select{width:100%;height:100%;padding:0;margin:0;font-size:14px;border:none;background:transparent;box-sizing:border-box;outline:none;}
.fill-handle              {position:absolute;right:2px;bottom:2px;width:8px;height:8px;background:var(--primary-color);border-radius:2px;cursor:crosshair;display:none;}
.report-cell:hover .fill-handle{display:block;}
button:disabled           {background:#ccc;cursor:not-allowed;}
.loading                  {position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,.7);display:flex;justify-content:center;align-items:center;z-index:9999;}
.loading-spinner          {border:8px solid #f3f3f3;border-top:8px solid var(--primary-color);border-radius:50%;width:60px;height:60px;animation:spin 1s linear infinite;}
@keyframes spin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}
#notification             {position:fixed;top:20px;right:20px;background:var(--primary-color);color:#fff;padding:15px 20px;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,.2);z-index:10000;transition:opacity .5s;}
#notification.error       {background:#d32f2f;}
.modal                    {position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);display:block;z-index:10001;}
.modal-content            {background:#fff;margin:6% auto;padding:20px;border-radius:8px;width:460px;text-align:center;box-shadow:0 5px 15px rgba(0,0,0,.3);}
.modal-content button     {margin:0 10px;padding:8px 16px;border:none;border-radius:4px;cursor:pointer;transition:.3s;background:var(--primary-color);color:#fff;}
.modal-content button:hover{background:var(--primary-hover);}
.edit-fields-modal-content{max-height:70vh;overflow-y:auto;text-align:left;}
.alias-grid               {display:grid;grid-template-columns:repeat(2,1fr);column-gap:12px;row-gap:8px;margin-top:8px;}
.alias-grid label         {display:flex;align-items:center;gap:6px;}
.resizer                  {position:absolute;top:0;right:0;width:5px;height:100%;cursor:col-resize;user-select:none;}
.exact-filter-dropdown    {position:absolute;z-index:20000;background:#fff;border:1px solid #ccc;border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,.2);max-height:300px;overflow:auto;padding:10px;}
.exact-filter-footer      {display:flex;justify-content:flex-end;gap:10px;margin-top:8px;}
.exact-filter-btn         {background:#e0e0e0 !important;padding:3px 10px !important;font-size:12px !important;margin-bottom:4px;}
.selected-tags            {margin:4px 0;display:flex;flex-wrap:wrap;gap:4px;}
.filter-chip              {background:#e0e0e0;border-radius:16px;padding:2px 8px;font-size:12px;display:inline-flex;align-items:center;color:#333;}
.chip-remove              {margin-left:4px;cursor:pointer;font-weight:bold;color:#888;}
.chip-remove:hover        {color:#555;}
.cell-selected            {background:var(--primary-light) !important;}
.fill-preview-box         {position:absolute;border:2px dashed var(--primary-color);box-sizing:border-box;pointer-events:none;}
.sticky-op,.sticky-del,.sticky-copy{position:sticky;background:#fff;width:80px;min-width:80px;max-width:80px;right:auto;top:auto;z-index:1;}
.sticky-copy{right:0;} .sticky-del{right:80px;} .sticky-op{right:160px;}
.column-selected          {background:var(--primary-color) !important;color:#fff !important;}
.highlight-flash          {animation:highlightFlash 2s;}
@keyframes highlightFlash{0%,100%{background:transparent;}50%{background:yellow;}}

.color-fill-wrapper { position: relative; }
.color-fill-button  {display:flex;align-items:center;gap:4px;background:var(--primary-color);color:#fff;border:none;border-radius:4px;padding:8px 12px;font-size:14px;cursor:pointer;transition:.3s;}
.color-fill-button:hover:not(:disabled){ background:var(--primary-hover); }
.color-preview     { display:inline-block;width:16px;height:16px;border:1px solid #888; }
.color-dropdown    {position:absolute;top:40px;right:0;background:#fff;border:1px solid #ccc;border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,.2);padding:8px;display:grid;grid-template-columns:repeat(5,24px);gap:6px;z-index:30000;}
.color-swatch      { width:24px;height:24px;border:1px solid #999;cursor:pointer; }
.color-swatch:hover{ outline:2px solid var(--primary-color); }

.checkbox-cell input {width: 14px;height: 14px;cursor: pointer;}
</style>

