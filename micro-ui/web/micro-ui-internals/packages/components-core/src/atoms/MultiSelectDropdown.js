import React, { useEffect, useReducer, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import RemoveableTag from "./RemoveableTag";
import { SVG } from "./SVG";
import Button from "./Button";
import TreeSelect from "./TreeSelect";

const MultiSelectDropdown = ({
  options,
  optionsKey,
  selected = [],
  onSelect,
  defaultLabel = "",
  defaultUnit = "",
  BlockNumber = 1,
  isOBPSMultiple = false,
  props,
  isPropsNeeded = false,
  ServerStyle = {},
  config,
  disabled,
  variant,
}) => {
  const [active, setActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState();
  const [optionIndex, setOptionIndex] = useState(-1);
  const dropdownRef = useRef();
  const { t } = useTranslation();

  function reducer(state, action) {
    switch (action.type) {
      case "ADD_TO_SELECTED_EVENT_QUEUE":
        return [...state, { code: action.payload?.[1]?.code, propsData: action.payload }];
      case "REMOVE_FROM_SELECTED_EVENT_QUEUE":
        const newState = state.filter((e) => e?.code !== action.payload?.[1]?.code);
        onSelect(
          newState.map((e) => e.propsData),
          props
        ); // Update the form state here
        return newState;
      case "REPLACE_COMPLETE_STATE":
        return action.payload;
      default:
        return state;
    }
  }

  useEffect(() => {
    dispatch({ type: "REPLACE_COMPLETE_STATE", payload: fnToSelectOptionThroughProvidedSelection(selected) });
  }, [selected?.length]);

  function fnToSelectOptionThroughProvidedSelection(selected) {
    return selected?.map((e) => ({ code: e?.code, propsData: [null, e] }));
  }
  const [alreadyQueuedSelectedState, dispatch] = useReducer(reducer, selected, fnToSelectOptionThroughProvidedSelection);

  useEffect(() => {
    if (!active) {
      onSelect(
        alreadyQueuedSelectedState?.map((e) => e.propsData),
        props
      );
    }
  }, [active]);

  function handleOutsideClickAndSubmitSimultaneously() {
    setActive(false);
  }

  window?.Digit?.Hooks.useClickOutside(dropdownRef, handleOutsideClickAndSubmitSimultaneously, active, { capture: true });
  const filtOptns =
    searchQuery?.length > 0
      ? options.filter(
          (option) =>
            t(option[optionsKey] && typeof option[optionsKey] == "string" && option[optionsKey].toUpperCase())
              .toLowerCase()
              .indexOf(searchQuery.toLowerCase()) >= 0
        )
      : options;

  function onSearch(e) {
    setSearchQuery(e.target.value);
  }

  function onSelectToAddToQueue(...props) {
    const isChecked = arguments[0].target.checked;
    isChecked
      ? dispatch({ type: "ADD_TO_SELECTED_EVENT_QUEUE", payload: arguments })
      : dispatch({ type: "REMOVE_FROM_SELECTED_EVENT_QUEUE", payload: arguments });
  }
  const IconRender = (iconReq) => {
    try {
      const components = require("@egovernments/digit-ui-react-components");
      const DynamicIcon = components?.SVG[iconReq] || components?.[iconReq];
      if (DynamicIcon) {
        const svgElement = DynamicIcon({
          width: "1.25rem",
          height: "1.25rem",
          fill: "#505A5F",
          className: "",
        });
        return svgElement;
      } else {
        console.log("Icon not found");
        return null;
      }
    } catch (error) {
      console.error("Icon not found");
      return null;
    }
  };
  const handleClearAll = () => {
    dispatch({ type: "REPLACE_COMPLETE_STATE", payload: [] });
    onSelect([], props);
  };
  /* Custom function to scroll and select in the dropdowns while using key up and down */
  const keyChange = (e) => {
    if (e.key == "ArrowDown") {
      setOptionIndex((state) => (state + 1 == filtOptns.length ? 0 : state + 1));
      if (optionIndex + 1 == filtOptns.length) {
        e?.target?.parentElement?.parentElement?.children?.namedItem("jk-dropdown-unique")?.scrollTo?.(0, 0);
      } else {
        optionIndex > 2 && e?.target?.parentElement?.parentElement?.children?.namedItem("jk-dropdown-unique")?.scrollBy?.(0, 45);
      }
      e.preventDefault();
    } else if (e.key == "ArrowUp") {
      setOptionIndex((state) => (state !== 0 ? state - 1 : filtOptns.length - 1));
      if (optionIndex === 0) {
        e?.target?.parentElement?.parentElement?.children?.namedItem("jk-dropdown-unique")?.scrollTo?.(100000, 100000);
      } else {
        optionIndex > 2 && e?.target?.parentElement?.parentElement?.children?.namedItem("jk-dropdown-unique")?.scrollBy?.(0, -45);
      }
      e.preventDefault();
    } else if (e.key == "Enter") {
      onSelectToAddToQueue(e, filtOptns[optionIndex]);
    }
  };

  const filteredOptions =
    searchQuery?.length > 0
      ? options.filter(
          (option) =>
            t(option[optionsKey] && typeof option[optionsKey] == "string" && option[optionsKey].toUpperCase())
              .toLowerCase()
              .indexOf(searchQuery.toLowerCase()) >= 0
        )
      : options;

  const flattenOptions = (options) => {
    let flattened = [];
    options.forEach((option) => {
      if (option.options) {
        flattened.push(option);
        flattened = flattened.concat(option.options);
      } else {
        flattened.push(option);
      }
    });
    return flattened;
  };

  const flattenedOptions = flattenOptions(filteredOptions);

  const MenuItem = ({ option, index }) => (
    <div
      key={index}
      className={`multiselect-dropodwn-menuitem ${variant ? variant : ""} ${
        alreadyQueuedSelectedState.find((selectedOption) => selectedOption.code === option.code) ? "checked" : ""
      }`}
    >
      <input
        type="checkbox"
        value={option.code}
        checked={alreadyQueuedSelectedState.find((selectedOption) => selectedOption.code === option.code) ? true : false}
        onChange={(e) =>
          isPropsNeeded
            ? onSelectToAddToQueue(e, option, props)
            : isOBPSMultiple
            ? onSelectToAddToQueue(e, option, BlockNumber)
            : onSelectToAddToQueue(e, option)
        }
        className={`digit-multi-select-dropdown-menuitem ${variant ? variant : ""}`}
      />
      <div className="digit-custom-checkbox">
        <SVG.Check fill={"white"} />
      </div>
      {option?.icon && IconRender(option?.icon)}
      <p
        className="digit-label"
      >
        {t(option[optionsKey] && typeof option[optionsKey] == "string" && option[optionsKey])}
      </p>
    </div>
  );

  const Menu = () => {
    const optionsToRender = variant === "nestedmultiselect" ? flattenedOptions : filteredOptions;

    return optionsToRender.map((option, index) => {
      if (option.options) {
        return (
          <div key={index} className="digit-nested-category">
            <div className="digit-category-name">{option.name}</div>
          </div>
        );
      } else {
        return <MenuItem option={option} key={index} index={index} />;
      }
    });
  };

  return (
    <div>
      <div
        className={`digit-multi-select-dropdown-wrap ${props?.className ? props?.className : ""} ${variant ? variant : ""}`}
        ref={dropdownRef}
        style={props?.style}
      >
        <div className={`digit-master${active ? `-active` : ``} ${disabled ? "disabled" : ""}`}>
          <input
            className="digit-cursorPointer"
            style={{ opacity: 0 }}
            type="text"
            onKeyDown={keyChange}
            onFocus={() => setActive(true)}
            value={searchQuery}
            onChange={onSearch}
          />
          <div className="digit-label">
            <p>{alreadyQueuedSelectedState.length > 0 ? `${alreadyQueuedSelectedState.length} ${defaultUnit} Selected` : defaultLabel}</p>
            <SVG.ArrowDropDown fill={disabled ? "#B1B4B6" : "black"} />
          </div>
        </div>
        {active ? (
          <div className="digit-server" id="jk-dropdown-unique" style={ServerStyle ? ServerStyle : {}}>
            {variant === "treemultiselect" ? (
              <TreeSelect 
              options={options} 
              onSelect={onSelectToAddToQueue} 
              selectedOption={alreadyQueuedSelectedState} 
              variant={variant} 
              />
            ) : (
              <Menu />
            )}
          </div>
        ) : null}
      </div>
      {config?.isDropdownWithChip ? (
        <div className="digit-tag-container">
          {alreadyQueuedSelectedState.length > 0 &&
            alreadyQueuedSelectedState.map((value, index) => {
              return (
                <RemoveableTag
                  key={index}
                  text={`${t(value.code).slice(0, 22)} ...`}
                  onClick={isPropsNeeded ? (e) => onSelectToAddToQueue(e, value, props) : (e) => onSelectToAddToQueue(e, value)}
                  className="multiselectdropdown-tag"
                />
              );
            })}
          {alreadyQueuedSelectedState.length > 0 && (
            <Button
              label={t("Clear All")}
              onClick={handleClearAll}
              variation="secondary"
              style={{
                width: "4.75rem",
                height: "2.375rem",
                padding: "0.5rem",
                justifyContent: "center",
                alignItems: "center",
                borderRadius: "3.125rem",
              }}
              textStyles={{ fontSize: "0.875rem", fontWeight: "400" ,width:"100%"}}
            />
          )}
        </div>
      ) : null}
    </div>
  );
};

MultiSelectDropdown.propTypes = {
  options: PropTypes.array.isRequired,
  optionsKey: PropTypes.string.isRequired,
  selected: PropTypes.array,
  onSelect: PropTypes.func.isRequired,
  defaultLabel: PropTypes.string,
  defaultUnit: PropTypes.string,
  BlockNumber: PropTypes.number,
  isOBPSMultiple: PropTypes.bool,
  props: PropTypes.object,
  isPropsNeeded: PropTypes.bool,
  ServerStyle: PropTypes.object,
  config: PropTypes.object,
};

export default MultiSelectDropdown;
