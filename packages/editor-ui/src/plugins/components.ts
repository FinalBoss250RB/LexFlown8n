// @ts-nocheck

import Vue from "vue";
import Fragment from 'vue-fragment';

import "regenerator-runtime/runtime";

import VueAgile from 'vue-agile';

import {
	// element ui components
	Dialog,
	Drawer,
	Dropdown,
	DropdownMenu,
	DropdownItem,
	Submenu,
	Radio,
	RadioGroup,
	RadioButton,
	Checkbox,
	Switch,
	Select,
	Option,
	OptionGroup,
	ButtonGroup,
	Table,
	TableColumn,
	DatePicker,
	Tabs,
	TabPane,
	Tag,
	Row,
	Col,
	Badge,
	Card,
	ColorPicker,
	Container,
	Loading,
	MessageBox,
	Message,
	Notification,
	CollapseTransition,
	Pagination,
	Popover,

	N8nInfoAccordion,
	N8nActionBox,
	N8nAvatar,
	N8nActionToggle,
	N8nButton,
	N8nElButton,
	N8nCallout,
	N8nPanelCallout,
	N8nCard,
	N8nIcon,
	N8nIconButton,
	N8nInfoTip,
	N8nInput,
	N8nInputLabel,
	N8nInputNumber,
	N8nLink,
	N8nLoading,
	N8nHeading,
	N8nMarkdown,
	N8nMenu,
	N8nMenuItem,
	N8nNotice,
	N8nOption,
	N8nRadioButtons,
	N8nSelect,
	N8nSpinner,
	N8nSticky,
	N8nTabs,
	N8nFormInputs,
	N8nFormBox,
	N8nPulse,
	N8nSquareButton,
	N8nTags,
	N8nTag,
	N8nText,
	N8nTooltip,
} from 'n8n-design-system';
import { ElMessageBoxOptions } from "element-ui/types/message-box";

Vue.use(Fragment.Plugin);

// n8n design system
Vue.component('n8n-info-accordion', N8nInfoAccordion);
Vue.component('n8n-action-box', N8nActionBox);
Vue.component('n8n-action-toggle', N8nActionToggle);
Vue.component('n8n-avatar', N8nAvatar);
Vue.component('n8n-button', N8nButton);
Vue.component('el-button', N8nElButton);
Vue.component('n8n-callout', N8nCallout);
Vue.component('n8n-panel-callout', N8nPanelCallout);
Vue.component('n8n-card', N8nCard);
Vue.component('n8n-form-box', N8nFormBox);
Vue.component('n8n-form-inputs', N8nFormInputs);
Vue.component('n8n-icon', N8nIcon);
Vue.component('n8n-icon-button', N8nIconButton);
Vue.component('n8n-info-tip', N8nInfoTip);
Vue.component('n8n-input', N8nInput);
Vue.component('n8n-input-label', N8nInputLabel);
Vue.component('n8n-input-number', N8nInputNumber);
Vue.component('n8n-loading', N8nLoading);
Vue.component('n8n-heading', N8nHeading);
Vue.component('n8n-link', N8nLink);
Vue.component('n8n-markdown', N8nMarkdown);
Vue.component('n8n-menu', N8nMenu);
Vue.component('n8n-menu-item', N8nMenuItem);
Vue.component('n8n-notice', N8nNotice);
Vue.component('n8n-option', N8nOption);
Vue.component('n8n-pulse', N8nPulse);
Vue.component('n8n-select', N8nSelect);
Vue.component('n8n-spinner', N8nSpinner);
Vue.component('n8n-sticky', N8nSticky);
Vue.component('n8n-radio-buttons', N8nRadioButtons);
Vue.component('n8n-square-button', N8nSquareButton);
Vue.component('n8n-tags', N8nTags);
Vue.component('n8n-tabs', N8nTabs);
Vue.component('n8n-tag', N8nTag);
Vue.component('n8n-text', N8nText);
Vue.component('n8n-tooltip', N8nTooltip);

// element io
Vue.use(Dialog);
Vue.use(Drawer);
Vue.use(Dropdown);
Vue.use(DropdownMenu);
Vue.use(DropdownItem);
Vue.use(Submenu);
Vue.use(Radio);
Vue.use(RadioGroup);
Vue.use(RadioButton);
Vue.use(Checkbox);
Vue.use(Switch);
Vue.use(Select);
Vue.use(Option);
Vue.use(OptionGroup);
Vue.use(ButtonGroup);
Vue.use(Table);
Vue.use(TableColumn);
Vue.use(DatePicker);
Vue.use(Tabs);
Vue.use(TabPane);
Vue.use(Tag);
Vue.use(Row);
Vue.use(Col);
Vue.use(Badge);
Vue.use(Card);
Vue.use(ColorPicker);
Vue.use(Container);
Vue.use(Pagination);
Vue.use(Popover);

Vue.use(VueAgile);

Vue.component(CollapseTransition.name, CollapseTransition);

Vue.use(Loading.directive);

Vue.prototype.$loading = Loading.service;
Vue.prototype.$msgbox = MessageBox;

Vue.prototype.$alert = async (message: string, configOrTitle: string | ElMessageBoxOptions | undefined, config: ElMessageBoxOptions | undefined) => {
	let temp = config || (typeof configOrTitle === 'object' ? configOrTitle : {});
	temp = {
		...temp,
		cancelButtonClass: 'btn--cancel',
		confirmButtonClass: 'btn--confirm',
	};

	if (typeof configOrTitle === 'string') {
		return await MessageBox.alert(message, configOrTitle, temp);
	}
	return await MessageBox.alert(message, temp);
};

Vue.prototype.$confirm = async (message: string, configOrTitle: string | ElMessageBoxOptions | undefined, config: ElMessageBoxOptions | undefined) => {
	let temp = config || (typeof configOrTitle === 'object' ? configOrTitle : {});
	temp = {
		...temp,
		cancelButtonClass: 'btn--cancel',
		confirmButtonClass: 'btn--confirm',
		distinguishCancelAndClose: true,
		showClose: config.showClose || false,
		closeOnClickModal: false,
	};

	if (typeof configOrTitle === 'string') {
		return await MessageBox.confirm(message, configOrTitle, temp);
	}
	return await MessageBox.confirm(message, temp);
};

Vue.prototype.$prompt = async (message: string, configOrTitle: string | ElMessageBoxOptions | undefined, config: ElMessageBoxOptions | undefined) => {
	let temp = config || (typeof configOrTitle === 'object' ? configOrTitle : {});
	temp = {
		...temp,
		cancelButtonClass: 'btn--cancel',
		confirmButtonClass: 'btn--confirm',
	};

	if (typeof configOrTitle === 'string') {
		return await MessageBox.prompt(message, configOrTitle, temp);
	}
	return await MessageBox.prompt(message, temp);
};

Vue.prototype.$notify = Notification;
Vue.prototype.$message = Message;
