# Python 类型注解（Type Hints）

## 概述

类型注解（Type Hints）是一种为代码添加"说明标签"的技术，明确指出变量、函数参数和返回值应该是什么数据类型。它就像给包裹写明"易碎品"和"向上箭头"，让快递员（解释器）知道如何正确处理。

### 核心目的

- **提高代码可读性**：让他人（以及未来的你）一眼就能看懂代码的意图
- **便于静态检查**：在运行代码前，通过工具发现潜在的类型错误
- **增强IDE支持**：让代码编辑器提供更准确的自动补全和提示

## 基础语法

### 变量注解

从 Python 3.6 开始，可以直接为变量添加类型注解：

```python
# 没有类型注解的代码
name = "Alice"
age = 30
is_student = False
scores = [95, 88, 91]

# 有类型注解的代码
name: str = "Alice"       # 注解为字符串 (str)
age: int = 30             # 注解为整数 (int)
is_student: bool = False  # 注解为布尔值 (bool)
scores: list = [95, 88, 91] # 注解为列表 (list)
```

### 函数注解

在函数参数后加 `: 类型`，返回值使用 `-> 类型`：

```python
# 没有类型注解的函数
def greet(first_name, last_name):
    full_name = first_name + " " + last_name
    return "Hello, " + full_name

# 有类型注解的函数
def greet(first_name: str, last_name: str) -> str:
    full_name = first_name + " " + last_name
    return "Hello, " + full_name
```

### 参数默认值

```python
def say_hello(name: str, times: int = 1) -> str:
    """向某人问好指定次数"""
    return " ".join([f"Hello, {name}!"] * times)
```

## 复杂类型注解

### 容器类型

```python
from typing import List, Dict, Tuple, Set

# List[int] 表示这是一个只包含整数的列表
numbers: List[int] = [1, 2, 3, 4, 5]

# Dict[str, int] 表示这是一个键为字符串、值为整数的字典
student_scores: Dict[str, int] = {"Alice": 95, "Bob": 88}

# Tuple[int, str, bool] 表示这是一个包含整数、字符串、布尔值的元组
person_info: Tuple[int, str, bool] = (25, "Alice", True)

# Set[str] 表示这是一个只包含字符串的集合
unique_names: Set[str] = {"Alice", "Bob", "Charlie"}
```

### 可选类型（Optional）

```python
from typing import Optional

def find_student(name: str) -> Optional[str]:
    """根据名字查找学生，可能找到也可能返回None"""
    students = {"Alice": "A001", "Bob": "B002"}
    return students.get(name)  # 可能返回字符串或None
```

### 联合类型（Union）

```python
from typing import Union

def process_input(data: Union[str, int, List[int]]) -> None:
    """处理可能是字符串、整数或整数列表的输入"""
    if isinstance(data, str):
        print(f"字符串: {data}")
    elif isinstance(data, int):
        print(f"整数: {data}")
    elif isinstance(data, list):
        print(f"列表: {data}")
```

## 实战应用

### 使用 Mypy 进行静态类型检查

```bash
# 安装 mypy
pip install mypy

# 检查文件
mypy example.py
```

### IDE 中的实时检查

现代 IDE（如 VS Code、PyCharm）都内置了类型检查支持：

- 错误高亮：类型不匹配的代码会被标记出来
- 智能提示：输入代码时会显示参数和返回值的类型信息
- 自动补全：基于类型信息提供更准确的代码补全建议

## 最佳实践

1. **渐进式采用**：从新代码开始使用类型注解，逐步为重要的旧代码添加注解
2. **保持一致性**：在项目中保持统一的注解风格
3. **避免过度注解**：对于过于明显的类型可以省略注解
4. **处理第三方库**：为没有类型注解的第三方库添加类型注解

## 常见问题

- **类型注解会影响性能吗？** 不会，类型注解在运行时会被忽略，只用于静态分析
- **必须使用类型注解吗？** 不强制，但强烈推荐使用，特别是大型项目
- **如果注解错了会怎么样？** 类型检查器会报错，但程序仍然可以运行

## 综合示例

```python
from typing import List, Dict, Optional, Union

def process_students(students: List[Dict[str, Union[str, int]]]) -> Optional[float]:
    """
    处理学生数据，计算平均分数
    
    参数:
        students: 学生列表，每个学生是包含'name'和'score'的字典
      
    返回:
        平均分数（浮点数），如果没有学生则返回None
    """
    if not students:
        return None
    
    total = 0
    for student in students:
        total += student['score']
    
    return total / len(students)

# 测试数据
students_data = [
    {"name": "Alice", "score": 95},
    {"name": "Bob", "score": 88},
    {"name": "Charlie", "score": 92}
]

average = process_students(students_data)
print(f"平均分: {average}")
```

---

**来源页面**: [Python 类型注解（Type Hints） | 菜鸟教程](https://www.runoob.com/python3/python-type-hints.html)